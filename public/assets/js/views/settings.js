// Cmail — settings view (appearance, security, admin: health/general/sending/users)
import { api, state, errText } from '../api.js';
import { t, lang, setLang } from '../i18n.js';
import { h, clear, icon, toast, modal, confirmBox, copyText, fmtBytes, fmtDate } from '../ui.js';
import { setTheme, setAccent, setBg } from '../app.js';
import { healthPane } from '../health.js';

// the active settings tab survives re-renders (mood switching redraws the pane)
let settingsTab = '';

export async function renderSettings(root) {
  clear(root);
  const view = h('div', { class: 'view' });
  view.append(h('div', { class: 'page-head' },
    h('div', {},
      h('div', { class: 'eyebrow' }, t('eyebrowSettings')),
      h('h2', { class: 'page-title' }, t('settingsTitle')),
      h('div', { class: 'page-sub' }, t('paletteSub'))),
  ));

  const isAdmin = state.user?.role === 'admin';
  const tabs = isAdmin
    ? [['health', t('health'), 'zap'], ['appearance', t('appearance'), 'sun'], ['security', t('security'), 'shield'], ['general', t('general'), 'settings'], ['sending', t('sending'), 'send']]
    : [['appearance', t('appearance'), 'sun'], ['security', t('security'), 'shield']];

  const tabBar = h('div', { class: 'filters', style: { padding: 0, marginBottom: '14px' } });
  const body = h('div', {});
  // the active tab survives re-renders (mood switching redraws the pane)
  let current = (isAdmin && settingsTab === 'health') || tabs.find(([k]) => k === settingsTab) ? settingsTab : (isAdmin ? 'health' : 'appearance');

  function drawTabs() {
    clear(tabBar);
    for (const [key, label, ic] of tabs) {
      tabBar.append(h('button', { class: `chip ${current === key ? 'is-on' : ''}`, onclick: () => { current = key; settingsTab = key; drawTabs(); drawBody(); } }, icon(ic), label));
    }
  }

  async function drawBody() {
    clear(body);
    if (current === 'appearance') body.append(await appearancePane());
    if (current === 'security') body.append(await securityPane());
    if (isAdmin && current === 'health') body.append(await healthPane());
    if (isAdmin && current === 'general') body.append(await generalPane());
    if (isAdmin && current === 'sending') body.append(await sendingPane());
  }

  view.append(tabBar, body);
  root.append(view);
  drawTabs();
  await drawBody();
}

// ---------- appearance ----------
async function appearancePane() {
  const pane = h('div', { class: 'settings-grid' });

  // the stage behind everything: aurora / halo / pure
  const bgMode = document.documentElement.dataset.bg || 'aurora';
  const bgRow = h('div', { class: 'set-row' },
    h('div', {}, h('div', { class: 'set-row__t' }, t('bgTitle')), h('div', { class: 'set-row__d' }, t('bgSub'))),
    h('div', { class: 'row' },
      ...[['aurora', 'bgAurora', 'spark'], ['halo', 'bgHalo', 'sun'], ['pure', 'bgPure', 'flat']].map(([m, key, ic]) =>
        h('button', { class: `chip ${bgMode === m ? 'is-on' : ''}`, onclick: () => { setBg(m); redraw(); } }, icon(ic), t(key)))));

  // theme
  const themeRow = h('div', { class: 'set-row' },
    h('div', {}, h('div', { class: 'set-row__t' }, t('theme'))),
    h('div', { class: 'row' },
      h('button', { class: `chip ${document.documentElement.dataset.theme === 'dark' ? 'is-on' : ''}`, onclick: () => { setTheme('dark'); redraw(); } }, icon('moon'), t('dark')),
      h('button', { class: `chip ${document.documentElement.dataset.theme === 'light' ? 'is-on' : ''}`, onclick: () => { setTheme('light'); redraw(); } }, icon('sun'), t('light'))));

  // language
  const langRow = h('div', { class: 'set-row' },
    h('div', {}, h('div', { class: 'set-row__t' }, t('language'))),
    h('div', { class: 'row' },
      h('button', { class: `chip ${lang === 'fa' ? 'is-on' : ''}`, onclick: () => { setLang('fa'); location.reload(); } }, t('persian')),
      h('button', { class: `chip ${lang === 'en' ? 'is-on' : ''}`, onclick: () => { setLang('en'); location.reload(); } }, t('english'))));

  function redraw() { appearancePane().then((p) => { pane.replaceWith(p); }); }

  pane.append(
    h('div', { class: 'glass card' }, h('h3', { style: { margin: '0 0 6px', fontSize: '15px' } }, t('appearance')),
      themeRow,
      bgRow,
      langRow),
    paletteCard(),
  );
  return pane;
}

// ---------- mood picker — the four named moods ----------
function paletteCard() {
  const palettes = [
    { key: 'sage', name: () => t('paletteSage'), light: '#b4cda3', deep: '#4f8f60' },
    { key: 'serene', name: () => t('paletteSerene'), light: '#9ec8dd', deep: '#3f7f9e' },
    { key: 'violet', name: () => t('paletteViolet'), light: '#c2a7e2', deep: '#7e5fa6' },
    { key: 'amber', name: () => t('paletteAmber'), light: '#eec27e', deep: '#a06a24' },
  ];
  const cur = document.documentElement.dataset.accent || 'sage';
  const grid = h('div', { class: 'palette-grid palette-grid--4' });
  for (const p of palettes) {
    grid.append(h('button', {
      class: `palette-card ${cur === p.key ? 'is-on' : ''}`,
      onclick: () => { setAccent(p.key); renderSettings(document.getElementById('app')); },
    },
      h('span', { class: 'palette-card__swatch', style: { background: `linear-gradient(125deg, ${p.light}, ${p.deep})` } },
        h('i', { style: { background: p.light } }), h('i', { style: { background: p.deep } })),
      h('span', { class: 'palette-card__name' }, p.name(), icon('check'))));
  }
  return h('div', { class: 'glass card' },
    h('h3', { style: { margin: '0 0 4px', fontSize: '15px' } }, t('palette')),
    h('p', { class: 'small muted', style: { margin: '0 0 14px' } }, t('paletteSub')),
    grid);
}

// ---------- security (account) ----------
async function securityPane() {
  const pane = h('div', { class: 'settings-grid' });

  // access — how signing in works (single user)
  let s = null;
  try { s = (await api.get('/api/admin/settings')).settings; } catch { /* non-admin or offline */ }
  if (s) {
    const userChip = h('span', { class: `chip ${s.login_username ? 'is-on' : ''}` }, s.login_username ? t('loginUsernameOn') : t('loginUsernameOff'));
    const toggle = h('button', { class: `btn ${s.login_username ? '' : 'btn--primary'}` }, icon('user'), t('loginUsernameEdit'));
    toggle.addEventListener('click', () => {
      const next = !s.login_username;
      confirmBox(t('loginUsernameConfirm'), async () => {
        try {
          await api.put('/api/admin/settings', { login_username: next });
          toast(t('saved'), 'ok');
          renderSettings(document.getElementById('app'));
        } catch (e) { toast(errText(e), 'err'); }
      }, false);
      const box = document.querySelector('.modal')?.querySelector('.btn--danger, .btn--primary');
      if (box) box.textContent = next ? t('disable') : t('enable');
    });
    pane.append(h('div', { class: 'glass card' },
      h('h3', { style: { margin: '0 0 6px', fontSize: '15px' } }, t('accessTitle')),
      h('p', { class: 'small muted', style: { margin: '0 0 10px' } }, t('accessSub')),
      h('div', { class: 'set-row' },
        h('div', {}, h('div', { class: 'set-row__t' }, t('loginUsernameToggle')), h('div', { class: 'set-row__d' }, t('loginUsernameD'))),
        h('div', { class: 'row' }, userChip, toggle)),
    ));
  }

  // 2FA status
  const on = !!state.user?.totp_enabled;
  const statusChip = h('span', { class: `chip ${on ? 'is-on' : ''}` }, on ? t('twoFaOn') : t('twoFaOff'));
  const btn = h('button', { class: `btn ${on ? 'btn--danger' : 'btn--primary'}` }, on ? t('disable2fa') : t('enable2fa'));
  btn.addEventListener('click', () => (on ? disableFlow() : enableFlow()));

  pane.append(h('div', { class: 'glass card' },
    h('h3', { style: { margin: '0 0 6px', fontSize: '15px' } }, t('twoFa')),
    h('div', { class: 'set-row' }, h('div', {}, h('div', { class: 'set-row__t' }, t('twoFaRow')), h('div', { class: 'set-row__d' }, t('vaultSub'))), h('div', { class: 'row' }, statusChip, btn)),
  ));

  // password
  const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  pane.append(h('div', { class: 'glass card' },
    h('h3', { style: { margin: '0 0 12px', fontSize: '15px' } }, t('changePassword')),
    h('div', { class: 'field' }, h('label', {}, t('currentPassword')), cur),
    h('div', { class: 'field mt-1' }, h('label', {}, t('newPassword')), next),
    h('button', { class: 'btn btn--primary mt-2', onclick: async () => {
      try {
        await api.post('/api/auth/password', { current: cur.value, next: next.value });
        toast(t('passwordChanged'), 'ok');
        cur.value = next.value = '';
      } catch (e) { toast(errText(e), 'err'); }
    } }, t('changePassword')),
  ));

  async function enableFlow() {
    try {
      const r = await api.post('/api/auth/totp/start');
      const qr = h('div', { style: { display: 'grid', placeItems: 'center', background: '#fff', borderRadius: '14px', padding: '12px' } });
      // server-side rendered QR svg
      try {
        const res = await fetch('/api/auth/totp/qr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: r.secret, name: state.user?.username }), credentials: 'same-origin' });
        qr.innerHTML = await res.text();
      } catch { qr.textContent = r.secret; }
      const secretLine = h('div', { class: 'copy-line' }, h('span', {}, r.secret),
        h('button', { class: 'btn btn--sm btn--ghost', onclick: async () => { await copyText(r.secret); toast(t('copied'), 'ok', 1400); } }, icon('copy')));
      const code = h('input', { class: 'input mono', style: { textAlign: 'center', letterSpacing: '6px', fontSize: '18px' }, inputmode: 'numeric', maxlength: '6' });
      const m = modal({
        title: t('enable2fa'), iconName: 'shield',
        body: [
          h('p', { class: 'small muted', style: { margin: 0 } }, t('scanQr')),
          qr, secretLine,
          h('div', { class: 'field' }, h('label', {}, t('totpTitle')), code),
        ],
        footer: [
          h('button', { class: 'btn btn--ghost', onclick: () => m.close() }, t('cancel')),
          h('button', { class: 'btn btn--primary', onclick: async () => {
            try {
              await api.post('/api/auth/totp/enable', { secret: r.secret, code: code.value.trim() });
              toast(t('saved'), 'ok');
              m.close();
              state.user.totp_enabled = 1;
              renderSettings(document.getElementById('app'));
            } catch (e) { toast(errText(e), 'err'); }
          } }, t('verify')),
        ],
      });
    } catch (e) { toast(errText(e), 'err'); }
  }

  async function disableFlow() {
    const code = h('input', { class: 'input mono', style: { textAlign: 'center', letterSpacing: '6px', fontSize: '18px' }, inputmode: 'numeric', maxlength: '6' });
    const m = modal({
      title: t('disable2fa'), iconName: 'shield',
      body: [h('p', { class: 'small muted', style: { margin: 0 } }, t('totpSub')), h('div', { class: 'field' }, h('label', {}, t('totpTitle')), code)],
      footer: [
        h('button', { class: 'btn btn--ghost', onclick: () => m.close() }, t('cancel')),
        h('button', { class: 'btn btn--danger', onclick: async () => {
          try {
            await api.post('/api/auth/totp/disable', { code: code.value.trim() });
            toast(t('saved'), 'ok');
            m.close();
            state.user.totp_enabled = 0;
            renderSettings(document.getElementById('app'));
          } catch (e) { toast(errText(e), 'err'); }
        } }, t('disable2fa')),
      ],
    });
  }

  return pane;
}

// ---------- admin: general ----------
async function generalPane() {
  let s;
  try { s = (await api.get('/api/admin/settings')).settings; } catch (e) { toast(errText(e), 'err'); return h('div'); }
  let ov;
  try { ov = (await api.get('/api/admin/overview')).overview; } catch { ov = null; }

  const pane = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });

  const appName = h('input', { class: 'input', value: s.app_name });
  const ttl = h('input', { class: 'input', type: 'number', min: 1, max: 8760, value: s.temp_ttl_default });
  const maxAddr = h('input', { class: 'input', type: 'number', min: 1, max: 1000, value: s.max_addresses });
  const sess = h('input', { class: 'input', type: 'number', min: 1, max: 365, value: s.session_days });
  const ret = h('input', { class: 'input', type: 'number', min: 0, max: 3650, value: s.retention_days });

  if (ov) {
    pane.append(h('div', { class: 'stat-tiles' },
      tile(ov.addresses, t('navAddresses')), tile(ov.temp_addresses, t('temporary')),
      tile(ov.emails, t('navMail')), tile(ov.notes, t('noted')), tile(ov.totp_entries, t('navVault')),
      tile(fmtBytes(ov.storage_bytes), t('storageUsed'))));
  }
  pane.append(h('div', { class: 'glass card' },
    h('h3', { style: { margin: '0 0 12px', fontSize: '15px' } }, t('general')),
    row(t('appNameSet'), appName),
    row(t('defaultTtl'), ttl),
    row(t('maxAddresses'), maxAddr),
    row(t('sessionDays'), sess),
    row(t('retention'), ret),
    h('div', { class: 'row mt-2' },
      h('button', { class: 'btn btn--primary', onclick: async () => {
        try {
          await api.put('/api/admin/settings', {
            app_name: appName.value,
            temp_ttl_default: +ttl.value, max_addresses: +maxAddr.value,
            session_days: +sess.value, retention_days: +ret.value,
          });
          toast(t('settingsSaved'), 'ok');
        } catch (e) { toast(errText(e), 'err'); }
      } }, t('saveSettings')),
      h('button', { class: 'btn', onclick: async () => { try { await api.post('/api/admin/cleanup'); toast(t('cleanupDone'), 'ok'); } catch (e) { toast(errText(e), 'err'); } } }, icon('trash'), t('runCleanup')),
    ),
  ));

  function tile(n, l) { return h('div', { class: 'glass stat-tile' }, h('div', { class: 'stat-tile__n' }, String(n)), h('div', { class: 'stat-tile__l' }, l)); }
  function row(label, input) { return h('div', { class: 'set-row' }, h('div', { class: 'set-row__t' }, label), h('div', { style: { width: '170px' } }, input)); }
  return pane;
}

// ---------- admin: sending ----------
async function sendingPane() {
  let s;
  try { s = (await api.get('/api/admin/settings')).settings; } catch (e) { toast(errText(e), 'err'); return h('div'); }

  const prov = h('select', { class: 'input' },
    h('option', { value: 'none', selected: s.sending_provider === 'none' || undefined }, '—'),
    h('option', { value: 'brevo', selected: s.sending_provider === 'brevo' || undefined }, 'Brevo'),
    h('option', { value: 'resend', selected: s.sending_provider === 'resend' || undefined }, 'Resend'));
  const key = h('input', { class: 'input ltr', placeholder: s.sending_api_key_set ? '•••••••• (saved)' : 'API key' });
  const fromEmail = h('input', { class: 'input ltr', value: s.sending_from_email });
  const fromName = h('input', { class: 'input', value: s.sending_from_name });
  const testTo = h('input', { class: 'input ltr', placeholder: t('testTo') });

  return h('div', { class: 'glass card' },
    h('h3', { style: { margin: '0 0 12px', fontSize: '15px' } }, t('sending')),
    h('p', { class: 'small muted', style: { marginTop: 0 } },
      lang === 'fa'
        ? 'برای ارسال ایمیل از Cmail، یک سرویس ارسال تراکنشی (مثل Brevo یا Resend) وصل کن؛ کلید API آن‌ها را وارد کن و فرستنده را تنظیم کن. دامنه‌ی فرستنده باید در آن سرویس تأیید شده باشد.'
        : 'To send mail from Cmail, connect a transactional provider (Brevo or Resend), paste its API key and set the sender. The sender domain must be verified on the provider.'),
    h('div', { class: 'field' }, h('label', {}, t('provider')), prov),
    h('div', { class: 'field mt-1' }, h('label', {}, t('apiKey')), key),
    h('div', { class: 'field mt-1' }, h('label', {}, t('fromEmail')), fromEmail),
    h('div', { class: 'field mt-1' }, h('label', {}, t('fromName')), fromName),
    h('div', { class: 'row mt-2 row--wrap' },
      h('button', { class: 'btn btn--primary', onclick: async () => {
        try {
          await api.put('/api/admin/settings', {
            sending_provider: prov.value,
            sending_api_key: key.value.trim() || undefined,
            sending_from_email: fromEmail.value.trim(),
            sending_from_name: fromName.value.trim(),
          });
          // refresh the boot status so the compose option appears right away
          state.setup = await api.get('/api/setup/status').catch(() => state.setup);
          toast(t('settingsSaved'), 'ok');
          renderSettings(document.getElementById('app'));
        } catch (e) { toast(errText(e), 'err'); }
      } }, t('saveSettings')),
      h('button', { class: 'btn', onclick: async () => {
        try {
          await api.post('/api/admin/test-send', { to: testTo.value.trim() });
          toast(t('testOk'), 'ok');
        } catch (e) { toast(errText(e), 'err'); }
      } }, icon('send'), t('testSend')),
    ),
    h('div', { class: 'field mt-2' }, h('label', {}, t('testTo')), testTo),
  );
}
