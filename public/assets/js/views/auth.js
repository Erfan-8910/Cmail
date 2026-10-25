// Cmail — views: login / register / 2FA + first-run setup wizard
import { api, state, errText } from '../api.js';
import { t, lang, setLang } from '../i18n.js';
import { h, clear, icon, toast, copyText, vibrate } from '../ui.js';
import { setTheme } from '../app.js';

export function renderLogin(root) {
  const view = h('div', { class: 'view view--auth' });
  const wrap = h('div', { class: 'auth-wrap' });
  view.append(wrap);
  root.append(view);

  // header controls
  const ctrls = h('div', { class: 'auth-ctrls' },
    h('button', { class: 'glass-btn', title: t('theme'), onclick: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') }, icon('sun')),
    h('button', { class: 'glass-btn', title: t('language'), onclick: () => { setLang(lang === 'fa' ? 'en' : 'fa'); clear(root); renderLogin(root); } }, icon('globe')),
  );
  view.append(ctrls);

  const logo = h('img', { class: 'auth-logo', src: 'assets/img/logo-dark.png', alt: 'Cmail' });
  wrap.append(logo);
  wrap.append(h('p', { class: 'auth-foot' }, t('tagline')));

  let mode = 'login'; // login | register
  let pending = null;
  let form = null;

  const card = h('div', { class: 'auth-card glass' });
  wrap.append(card);

  function draw() {
    clear(card);
    card.append(
      h('h2', { class: 'auth-title' }, mode === 'login' ? t('loginTitle') : t('registerTitle')),
      h('p', { class: 'auth-sub' }, mode === 'login' ? t('loginSub') : t('registerSub')),
    );

    form = h('form', { class: 'auth-form' });
    form.append(
      field(t('username'), 'text', 'username', '', true),
      field(t('password'), 'password', 'password', ''),
    );
    if (mode === 'register') form.append(field(t('displayName'), 'text', 'display_name', ''));

    const submitBtn = h('button', { class: 'btn btn--primary', type: 'submit', style: { marginTop: '4px' } },
      icon(mode === 'login' ? 'arrow' : 'plus'), mode === 'login' ? t('login') : t('register'));
    form.append(submitBtn);
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    card.append(form);

    card.append(h('p', { class: 'auth-alt' },
      mode === 'login' ? t('noAccount') : t('haveAccount'), ' ',
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); mode = mode === 'login' ? 'register' : 'login'; draw(); } },
        mode === 'login' ? t('register') : t('login'))));
  }

  function field(label, type, name, value, autofocus) {
    const input = h('input', { class: 'input', type, name, value, autocomplete: type === 'password' ? 'current-password' : 'username', required: true });
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

  async function submit() {
    const fd = Object.fromEntries(new FormData(form).entries());
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (mode === 'login') {
        const r = await api.post('/api/auth/login', { username: fd.username, password: fd.password });
        if (r.totp_required) { pending = r.pending; drawTotp(); return; }
        state.user = r.user;
        location.hash = '#/mail';
      } else {
        const r = await api.post('/api/auth/register', fd);
        state.user = r.user;
        location.hash = '#/mail';
      }
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
        location.hash = '#/mail';
      } catch (err) {
        toast(errText(err), 'err');
        shakeCard();
        btn.disabled = false;
      }
    });
    card.append(f);
    setTimeout(() => codeInput.focus(), 60);
  }

  draw();
}

// ---------- first-run setup wizard ----------
export async function renderSetup(root) {
  try { state.setup = await api.get('/api/setup/status'); } catch { /* keep */ }
  if (state.setup?.admin_created && !state.user) { location.hash = '#/login'; return; }
  if (state.setup?.admin_created && state.user) { location.hash = '#/mail'; return; }

  const view = h('div', { class: 'view view--auth' });
  const wizard = h('div', { class: 'wizard' });
  view.append(wizard);

  view.append(h('div', { class: 'auth-ctrls' },
    h('button', { class: 'glass-btn', title: t('theme'), onclick: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') }, icon('sun')),
    h('button', { class: 'glass-btn', title: t('language'), onclick: () => { setLang(lang === 'fa' ? 'en' : 'fa'); clear(root); renderSetup(root); } }, icon('globe')),
  ));

  root.append(view);

  let step = 0;
  const TOTAL = 5;
  const card = h('div', { class: 'glass card', style: { padding: '34px 30px', marginTop: '14px' } });
  const stepsBar = h('div', { class: 'wizard__steps' });

  function drawSteps() {
    clear(stepsBar);
    for (let i = 0; i < TOTAL; i++) stepsBar.append(h('div', { class: `wizard__step ${i < step ? 'is-done' : i === step ? 'is-now' : ''}` }));
  }

  async function draw() {
    drawSteps();
    clear(card);
    if (step === 0) return drawWelcome();
    if (step === 1) return drawAdmin();
    if (step === 2) return drawDomain();
    if (step === 3) return drawSending();
    return drawFinish();
  }

  const iconBox = (name) => h('div', { class: 'wizard__icon' }, icon(name));

  function drawWelcome() {
    card.append(
      h('img', { class: 'auth-logo', src: 'assets/img/logo-dark.png', style: { width: '96px' }, alt: 'Cmail' }),
      h('h2', {}, t('setupWelcome')),
      h('p', { class: 'lead' }, t('setupLead')),
      h('button', { class: 'btn btn--primary', onclick: () => { step = 1; draw(); } }, t('next'), icon('chevron')),
    );
  }

  function drawAdmin() {
    card.append(iconBox('user'), h('h2', {}, t('s1Title')), h('p', { class: 'lead' }, t('s1Lead')));
    const u = h('input', { class: 'input', placeholder: t('username'), name: 'username', autocomplete: 'username' });
    const p = h('input', { class: 'input', type: 'password', placeholder: t('password'), name: 'password', autocomplete: 'new-password' });
    const dp = h('input', { class: 'input', placeholder: t('displayName'), name: 'display_name' });
    const btn = h('button', { class: 'btn btn--primary' }, icon('check'), t('next'));
    const back = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { step = 0; draw(); } }, t('cancel'));
    const f = h('form', { class: 'auth-form', style: { textAlign: 'start' } },
      h('div', { class: 'field' }, h('label', {}, t('username')), u),
      h('div', { class: 'field' }, h('label', {}, t('password')), p),
      h('div', { class: 'field' }, h('label', {}, t('displayName')), dp),
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, back, btn));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        const r = await api.post('/api/setup/admin', { username: u.value.trim(), password: p.value, display_name: dp.value });
        state.user = r.user;
        state.setup.admin_created = true;
        step = 2; draw();
      } catch (err) { toast(errText(err), 'err'); btn.disabled = false; }
    });
    card.append(f);
  }

  function drawDomain() {
    card.append(iconBox('globe'), h('h2', {}, t('s2Title')), h('p', { class: 'lead' }, t('s2Lead')));
    const d = h('input', { class: 'input ltr', placeholder: 'mail.example.com', name: 'domain' });
    const btn = h('button', { class: 'btn btn--primary' }, icon('check'), t('next'));
    const skip = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { step = 3; draw(); } }, t('skip'));
    const guide = h('div', {});
    const f = h('form', { class: 'auth-form', style: { textAlign: 'start' } },
      h('div', { class: 'field' }, h('label', {}, t('domainName')), d),
      guide,
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, skip, btn));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        await api.post('/api/setup/domain', { name: d.value.trim().toLowerCase() });
        state.setup.domains_configured = true;
        showGuide(d.value.trim().toLowerCase());
        btn.remove();
      } catch (err) { toast(errText(err), 'err'); btn.disabled = false; }
    });
    card.append(f);

    function showGuide(domain) {
      clear(guide);
      guide.append(
        h('div', { class: 'mt-2' },
          h('h3', { style: { fontSize: '14px', margin: '0 0 8px' } }, 'DNS — MX'),
          dnsTable([
            ['MX', '@', 'route1.mx.cloudflare.net', '10'],
            ['MX', '@', 'route2.mx.cloudflare.net', '20'],
            ['MX', '@', 'route3.mx.cloudflare.net', '30'],
          ]),
          h('h3', { style: { fontSize: '14px', margin: '14px 0 8px' } }, 'DNS — SPF (TXT)'),
          copyLine('v=spf1 include:_spf.mx.cloudflare.net ~all'),
          h('div', { class: 'mt-2' }, h('p', { class: 'small muted', style: { margin: 0 } },
            lang === 'fa'
              ? '۱) در داشبورد Cloudflare وارد دامنه شو → بخش Email Routing را فعال کن.'
              : '1) In the Cloudflare dashboard open the domain → enable Email Routing.'),
            h('p', { class: 'small muted', style: { margin: '4px 0 0' } },
              lang === 'fa'
                ? '۲) تب Routing → Catch-all address → Action را روی «Send to Worker» بگذار و Worker به نام cmail را انتخاب کن.'
                : '2) Routing tab → Catch-all address → set Action to "Send to Worker" and pick the cmail worker.'),
          ),
        ));
    }
  }

  function drawSending() {
    card.append(iconBox('send'), h('h2', {}, t('s3Title')), h('p', { class: 'lead' }, t('s3Lead')));
    const prov = h('select', { class: 'input' },
      h('option', { value: 'none' }, '— ' + t('skip') + ' —'),
      h('option', { value: 'brevo' }, 'Brevo'),
      h('option', { value: 'resend' }, 'Resend'));
    const key = h('input', { class: 'input ltr', placeholder: 'API key' });
    const from = h('input', { class: 'input ltr', placeholder: 'no-reply@yourdomain.com' });
    const btn = h('button', { class: 'btn btn--primary' }, icon('check'), t('next'));
    const skip = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { step = 4; draw(); } }, t('skip'));
    const f = h('form', { class: 'auth-form', style: { textAlign: 'start' } },
      h('div', { class: 'field' }, h('label', {}, t('provider')), prov),
      h('div', { class: 'field' }, h('label', {}, t('apiKey')), key),
      h('div', { class: 'field' }, h('label', {}, t('fromEmail')), from),
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, skip, btn));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (prov.value !== 'none') {
        try {
          await api.put('/api/admin/settings', {
            sending_provider: prov.value, sending_api_key: key.value.trim(), sending_from_email: from.value.trim(),
          });
        } catch (err) { toast(errText(err), 'err'); return; }
      }
      step = 4; draw();
    });
    card.append(f);
  }

  function drawFinish() {
    card.append(
      iconBox('zap'),
      h('h2', {}, t('s4Title')),
      h('p', { class: 'lead' }, t('s4Lead')),
      h('button', { class: 'btn btn--primary', onclick: () => { location.hash = '#/mail'; } }, t('finish'), icon('chevron')),
    );
  }

  wizard.append(stepsBar, card);
  draw();
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
