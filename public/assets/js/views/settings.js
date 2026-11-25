// Cmail — settings view (appearance, security, share, admin: health/general/sending/users)
import { api, state, errText } from '../api.js';
import { t, lang, setLang } from '../i18n.js';
import { h, clear, icon, toast, modal, confirmBox, copyText, fmtBytes, fmtDate, timeAgo, vibrate } from '../ui.js';
import { setTheme, setAccent, updateLockBadge, refreshLockBadge } from '../app.js';
import { invalidatePrintLogo } from '../print.js';
import { healthPane } from '../health.js';
import { sharePane } from './share.js';

// the active settings tab survives re-renders (mood switching redraws the pane)
let settingsTab = '';

export async function renderSettings(root, arg) {
  clear(root);
  // a deep link (#/settings/security) opens its tab directly — the 2FA padlock
  // at the top of the page lands exactly on the security room
  if (arg && ['health', 'appearance', 'security', 'general', 'sending', 'share'].includes(arg)) settingsTab = arg;
  // self-heal the admin gate: a stale session snapshot (an old tab, a restored
  // cache) must never hide the admin panes — the role is re-checked right here
  if (state.user && state.user.role !== 'admin') {
    try { const me = await api.get('/api/auth/me'); if (me?.user) state.user = me.user; } catch { /* offline — draw with what we have */ }
  }
  const view = h('div', { class: 'view' });
  view.append(h('div', { class: 'page-head' },
    h('div', {},
      h('div', { class: 'eyebrow' }, t('eyebrowSettings')),
      h('h2', { class: 'page-title' }, t('settingsTitle')),
      h('div', { class: 'page-sub' }, t('paletteSub'))),
  ));

  const isAdmin = state.user?.role === 'admin';
  const tabs = isAdmin
    ? [['health', t('health'), 'zap'], ['appearance', t('appearance'), 'sun'], ['security', t('security'), 'shield'], ['share', t('shareTab'), 'user'], ['general', t('general'), 'settings'], ['sending', t('sending'), 'send']]
    : [['appearance', t('appearance'), 'sun'], ['security', t('security'), 'shield']];

  const tabBar = h('div', { class: 'filters', style: { padding: 0, marginBottom: '14px' } });
  const body = h('div', {});
  // the active tab survives re-renders (mood switching redraws the pane)
  let current = (isAdmin && settingsTab === 'health') || tabs.find(([k]) => k === settingsTab) ? settingsTab : (isAdmin ? 'health' : 'appearance');

  // every pane fetches data before it paints — a token makes sure that when
  // the user races across the tabs, only the newest pane is allowed to land;
  // the stale ones bail silently instead of painting two sections at once
  let paneSeq = 0;

  function drawTabs() {
    clear(tabBar);
    for (const [key, label, ic] of tabs) {
      tabBar.append(h('button', { class: `chip ${current === key ? 'is-on' : ''}`, onclick: () => { vibrate(5); current = key; settingsTab = key; drawTabs(); drawBody(); } }, icon(ic), label));
    }
  }

  async function drawBody() {
    const seq = ++paneSeq;
    const want = current;
    clear(body);
    let pane = null;
    if (current === 'appearance') pane = await appearancePane();
    else if (current === 'security') pane = await securityPane();
    else if (isAdmin && current === 'health') pane = await healthPane();
    else if (isAdmin && current === 'share') pane = await sharePane();
    else if (isAdmin && current === 'general') pane = await generalPane();
    else if (isAdmin && current === 'sending') pane = await sendingPane();
    if (seq !== paneSeq || current !== want) return; // a newer tab already won
    clear(body);
    if (pane) body.append(pane);
  }

  view.append(tabBar, body);
  root.append(view);
  drawTabs();
  await drawBody();
}

// ---------- appearance ----------
// v3.2.0 — rebuilt tighter and cooler: one look card (theme + language as
// icon-led segmented rows), the palette wall, and the print identity card
// where the maker's own mark replaces the Cmail logo on the stamp and the
// paper. The background presence picker retired — the living stage is the
// one and only backdrop now, no settings row for it anymore.
async function appearancePane() {
  const pane = h('div', { class: 'settings-grid' });
  const isAdmin = state.user?.role === 'admin';

  // theme — the whole panel follows, saved on the spot
  const themeRow = h('div', { class: 'set-row set-row--tight' },
    h('div', {}, h('div', { class: 'set-row__t' }, t('lookThemeT')), h('div', { class: 'set-row__d' }, t('lookThemeD'))),
    h('div', { class: 'row' },
      h('button', { class: `chip chip--iconed ${document.documentElement.dataset.theme === 'dark' ? 'is-on' : ''}`, onclick: () => { setTheme('dark'); redraw(); } }, icon('moon'), t('dark')),
      h('button', { class: `chip chip--iconed ${document.documentElement.dataset.theme === 'light' ? 'is-on' : ''}`, onclick: () => { setTheme('light'); redraw(); } }, icon('sun'), t('light'))));

  // language — one pick repaints every word
  const langRow = h('div', { class: 'set-row set-row--tight' },
    h('div', {}, h('div', { class: 'set-row__t' }, t('lookLangT')), h('div', { class: 'set-row__d' }, t('lookLangD'))),
    h('div', { class: 'row' },
      h('button', { class: `chip ${lang === 'fa' ? 'is-on' : ''}`, onclick: () => { setLang('fa'); location.reload(); } }, t('persian')),
      h('button', { class: `chip ${lang === 'en' ? 'is-on' : ''}`, onclick: () => { setLang('en'); location.reload(); } }, t('english'))));

  function redraw() { appearancePane().then((p) => { pane.replaceWith(p); }); }

  pane.append(
    h('div', { class: 'glass card set-card' },
      h('h3', { class: 'set-card__t' }, icon('sun'), t('appearance')),
      themeRow,
      langRow),
    paletteCard(),
  );

  // ---------- print identity — the mark on the stamp and the paper ----------
  if (isAdmin) {
    let s = null;
    try { s = (await api.get('/api/admin/settings')).settings; } catch { /* offline — draw without */ }
    let curLogo = s?.print_logo || null;
    const preview = h('span', { class: 'print-logo__preview', style: curLogo ? { backgroundImage: `url(${curLogo})` } : {} },
      curLogo ? '' : icon('printer'));
    const previewWrap = h('div', { class: 'print-logo__plate' }, preview);
    const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: { display: 'none' } });
    const pickBtn = h('button', { class: 'btn btn--sm btn--primary' }, icon('plus'), t('printLogoPick'));
    const rmBtn = h('button', { class: `btn btn--sm ${curLogo ? '' : 'is-hidden-btn'}` }, icon('trash'), t('printLogoRemove'));

    fileIn.addEventListener('change', async () => {
      const f = fileIn.files?.[0];
      fileIn.value = '';
      if (!f) return;
      const url = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result || '')); fr.readAsDataURL(f); });
      if (!/^data:image\/(png|jpe?g|webp);base64,/.test(url) || url.length > 550_000) { toast(t('printLogoInvalid'), 'err'); return; }
      try {
        await api.put('/api/admin/settings', { print_logo: url });
        curLogo = url;
        invalidatePrintLogo();
        preview.style.backgroundImage = `url(${url})`;
        preview.textContent = '';
        rmBtn.classList.remove('is-hidden-btn');
        toast(t('printLogoSaved'), 'ok', 1800);
      } catch (e) { toast(errText(e), 'err'); }
    });
    pickBtn.addEventListener('click', () => fileIn.click());
    rmBtn.addEventListener('click', async () => {
      try {
        await api.put('/api/admin/settings', { print_logo: null });
        curLogo = null;
        invalidatePrintLogo();
        preview.style.backgroundImage = '';
        preview.textContent = '';
        preview.append(icon('printer'));
        rmBtn.classList.add('is-hidden-btn');
        toast(t('printLogoRemoved'), 'ok', 1600);
      } catch (e) { toast(errText(e), 'err'); }
    });

    pane.append(h('div', { class: 'glass card set-card' },
      h('h3', { class: 'set-card__t' }, icon('printer'), t('printCardTitle')),
      h('p', { class: 'small muted set-card__d' }, t('printCardSub')),
      h('div', { class: 'set-row set-row--tight' },
        previewWrap,
        h('div', { class: 'grow set-row__txt' },
          h('div', { class: 'set-row__t' }, t('printLogoTitle')),
          h('div', { class: 'set-row__d' }, t('printLogoSub')),
          h('div', { class: 'row', style: { marginTop: '8px', gap: '6px' } }, pickBtn, rmBtn)),
        fileIn),
    ));
  }

  return pane;
}

// ---------- mood picker — twelve palettes, named by their color ----------
function paletteCard() {
  const palettes = [
    { key: 'green', name: () => t('paletteGreen'), light: '#b4cda3', deep: '#4f8f60' },
    { key: 'blue', name: () => t('paletteBlue'), light: '#9ec8dd', deep: '#3f7f9e' },
    { key: 'purple', name: () => t('palettePurple'), light: '#c2a7e2', deep: '#7e5fa6' },
    { key: 'amber', name: () => t('paletteAmber'), light: '#eec27e', deep: '#a06a24' },
    { key: 'rose', name: () => t('paletteRose'), light: '#f0b6c4', deep: '#bf5470' },
    { key: 'cyan', name: () => t('paletteCyan'), light: '#8fd8d2', deep: '#2f8f8a' },
    { key: 'orange', name: () => t('paletteOrange'), light: '#f0b084', deep: '#c06a2a' },
    { key: 'lime', name: () => t('paletteLime'), light: '#cfe39a', deep: '#7ba03a' },
    { key: 'teal', name: () => t('paletteTeal'), light: '#9ad4c0', deep: '#2e8570' },
    { key: 'indigo', name: () => t('paletteIndigo'), light: '#aab3ee', deep: '#5560c0' },
    { key: 'slate', name: () => t('paletteSlate'), light: '#b3c0cf', deep: '#5d7285' },
    { key: 'crimson', name: () => t('paletteCrimson'), light: '#eda9a4', deep: '#bb4a42' },
  ];
  const cur = document.documentElement.dataset.accent || 'green';
  const grid = h('div', { class: 'palette-grid' });
  for (const p of palettes) {
    grid.append(h('button', { class: `palette-card ${cur === p.key ? 'is-on' : ''}` },
      h('span', { class: 'palette-card__swatch', style: { background: `linear-gradient(125deg, ${p.light}, ${p.deep})` } },
        h('i', { style: { background: p.light } }), h('i', { style: { background: p.deep } })),
      h('span', { class: 'palette-card__name' }, p.name(), icon('check'))));
  }
  // the accent repaints the room live through CSS variables — no full
  // re-render needed, just move the selection ring (rapid clicks stay safe)
  const cards = grid.querySelectorAll('.palette-card');
  palettes.forEach((p, i) => {
    cards[i].onclick = () => { setAccent(p.key); cards.forEach((c) => c.classList.remove('is-on')); cards[i].classList.add('is-on'); vibrate(5); };
  });
  return h('div', { class: 'glass card' },
    h('h3', { style: { margin: '0 0 4px', fontSize: '15px' } }, t('palette')),
    h('p', { class: 'small muted', style: { margin: '0 0 14px' } }, t('paletteSub')),
    grid);
}

// ---------- security (account) ----------
async function securityPane() {
  const pane = h('div', { class: 'settings-grid' });
  const isAdmin = state.user?.role === 'admin';

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

  const twoFaCard = h('div', { class: 'glass card' },
    h('h3', { style: { margin: '0 0 6px', fontSize: '15px' } }, t('twoFa')),
    h('div', { class: 'set-row' }, h('div', {}, h('div', { class: 'set-row__t' }, t('twoFaRow')), h('div', { class: 'set-row__d' }, t('vaultSub'))), h('div', { class: 'row' }, statusChip, btn)),
    // the honest preview: what the padlock at the top will do once this is on
    !on ? h('p', { class: 'small muted', style: { margin: '10px 0 0', display: 'flex', gap: '6px', alignItems: 'flex-start' } }, icon('lock'), h('span', {}, t('twoFaLockHint'))) : '',
  );

  // the re-ask timer — minutes after the last verified code during which a
  // fresh password sign-in skips the code step (admin: this is a global setting)
  if (isAdmin && s) {
    const grace = h('input', { class: 'input ltr', type: 'number', min: 0, max: 1440, value: String(s.totp_grace_min ?? 0), style: { width: '110px' } });
    twoFaCard.append(h('div', { class: 'set-row', style: { marginTop: '4px' } },
      h('div', {}, h('div', { class: 'set-row__t' }, t('graceT')), h('div', { class: 'set-row__d' }, t('graceD'))),
      h('div', { class: 'row' },
        grace,
        h('button', { class: 'btn btn--sm btn--primary', onclick: async () => {
          try {
            await api.put('/api/admin/settings', { totp_grace_min: Math.max(0, parseInt(grace.value, 10) || 0) });
            toast(t('settingsSaved'), 'ok');
          } catch (e) { toast(errText(e), 'err'); }
        } }, t('save')))));
  }
  pane.append(twoFaCard);

  // the padlock at the top — what it asks for when it locks the panel.
  // 'totp' (default) shows the padlock only with 2FA on; 'password' works
  // with 2FA off, so the padlock can live on the toolbar either way
  if (isAdmin && s) {
    const lockCur = s.lock_mode === 'password' ? 'password' : 'totp';
    const chipTotp = h('button', { class: `chip ${lockCur === 'totp' ? 'is-on' : ''}` }, icon('shield'), t('lockModeTotp'));
    const chipPw = h('button', { class: `chip ${lockCur === 'password' ? 'is-on' : ''}` }, icon('key'), t('lockModePw'));
    const note = h('p', { class: 'small muted', style: { margin: '8px 0 0' } },
      lockCur === 'totp' ? (on ? t('lockModeTotpD') : t('lockModeTotpNeed')) : t('lockModePwD'));
    const pick = (mode) => {
      vibrate(5);
      chipTotp.classList.toggle('is-on', mode === 'totp');
      chipPw.classList.toggle('is-on', mode === 'password');
      note.textContent = mode === 'totp' ? (on ? t('lockModeTotpD') : t('lockModeTotpNeed')) : t('lockModePwD');
      state.lockMode = mode;
      refreshLockBadge();
      api.put('/api/admin/settings', { lock_mode: mode })
        .then(() => toast(t('saved'), 'ok', 1400))
        .catch((e) => toast(errText(e), 'err'));
    };
    chipTotp.addEventListener('click', () => pick('totp'));
    chipPw.addEventListener('click', () => pick('password'));
    pane.append(h('div', { class: 'glass card' },
      h('h3', { style: { margin: '0 0 6px', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' } }, t('lockCard'), h('span', { class: 'icon-btn lock-badge', style: { pointerEvents: 'none' } }, icon('lockMode'))),
      h('p', { class: 'small muted', style: { margin: '0 0 10px' } }, t('lockCardSub')),
      h('div', { class: 'set-row' },
        h('div', {}, h('div', { class: 'set-row__t' }, t('lockAsk')), h('div', { class: 'set-row__d', style: { maxWidth: '460px' } }, note)),
        h('div', { class: 'row' }, chipTotp, chipPw)),
    ));
  }

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

  // devices & sessions — the remote kill switch (admin)
  if (isAdmin) pane.append(await devicesCard());

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
              updateLockBadge(true);
              renderSettings(document.getElementById('app'), 'security');
            } catch (e) { toast(errText(e), 'err'); }
          } }, t('verify')),
        ],
      });
    } catch (e) { toast(errText(e), 'err'); }
  }

  async function disableFlow() {
    const code = h('input', { class: 'input mono', style: { textAlign: 'center', letterSpacing: '6px', fontSize: '18px' }, inputmode: 'numeric', maxlength: '6' });
    // v3.1.0: disabling the second factor also demands the account password —
    // a session alone can no longer strip 2FA away
    const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const m = modal({
      title: t('disable2fa'), iconName: 'shield',
      body: [h('p', { class: 'small muted', style: { margin: 0 } }, t('totpSub')), h('div', { class: 'field' }, h('label', {}, t('disable2faPw')), pw), h('div', { class: 'field' }, h('label', {}, t('totpTitle')), code)],
      footer: [
        h('button', { class: 'btn btn--ghost', onclick: () => m.close() }, t('cancel')),
        h('button', { class: 'btn btn--danger', onclick: async () => {
          try {
            await api.post('/api/auth/totp/disable', { code: code.value.trim(), current: pw.value });
            toast(t('saved'), 'ok');
            m.close();
            state.user.totp_enabled = 0;
            updateLockBadge(false);
            renderSettings(document.getElementById('app'), 'security');
          } catch (e) { toast(errText(e), 'err'); }
        } }, t('disable2fa')),
      ],
    });
  }

  return pane;
}

// ---------- devices & sessions: every signed-in gadget, one kick each ----------
async function devicesCard() {
  const card = h('div', { class: 'glass card' },
    h('h3', { style: { margin: '0 0 4px', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' } }, t('devTitle'),
      h('button', { class: 'icon-btn', title: t('refresh'), 'aria-label': t('refresh'), onclick: () => fill() }, icon('refresh'))),
    h('p', { class: 'small muted', style: { margin: '0 0 12px' } }, t('devSub')));
  const list = h('div', { class: 'dev-list' }, h('div', { class: 'small muted', style: { padding: '6px 2px' } }, t('loading')));
  card.append(list,
    h('div', { class: 'row mt-2' },
      h('button', { class: 'btn btn--danger-ghost', onclick: () => confirmBox(t('devKickOthersConfirm'), async () => {
        try {
          const r = await api.post('/api/admin/sessions/revoke-others', {});
          toast(`${r.removed ?? 0} ${t('devKickedN')}`, 'ok', 2000);
          fill();
        } catch (e) { toast(errText(e), 'err'); }
      }) }, icon('logout'), t('devKickOthers'))));

  // the friendliest name a user-agent can give up
  function deviceInfo(ua) {
    const s = String(ua ?? '');
    let icn = 'monitor', name = lang === 'fa' ? 'دستگاه ناشناس' : 'Unknown device';
    if (/iphone/i.test(s)) { icn = 'phone'; name = 'iPhone'; }
    else if (/ipad/i.test(s)) { icn = 'phone'; name = 'iPad'; }
    else if (/android/i.test(s)) { icn = 'phone'; name = 'Android'; }
    else if (/windows/i.test(s)) { icn = 'monitor'; name = 'Windows'; }
    else if (/mac os x|macintosh/i.test(s)) { icn = 'monitor'; name = 'macOS'; }
    else if (/linux/i.test(s)) { icn = 'monitor'; name = 'Linux'; }
    let browser = lang === 'fa' ? 'مرورگر' : 'Browser';
    if (/edg\//i.test(s)) browser = 'Edge';
    else if (/chrome|crios/i.test(s)) browser = 'Chrome';
    else if (/firefox|fxios/i.test(s)) browser = 'Firefox';
    else if (/safari/i.test(s)) browser = 'Safari';
    return { icn, name: `${name} · ${browser}` };
  }

  async function fill() {
    clear(list);
    list.append(h('div', { class: 'small muted', style: { padding: '6px 2px' } }, t('loading')));
    let rows = [];
    try { rows = (await api.get('/api/admin/sessions')).sessions ?? []; }
    catch (e) { clear(list).append(h('div', { class: 'small muted', style: { padding: '6px 2px' } }, errText(e))); return; }
    clear(list);
    if (!rows.length) { list.append(h('div', { class: 'small muted', style: { padding: '6px 2px' } }, t('devEmpty'))); return; }
    for (const s of rows) {
      const d = deviceInfo(s.ua);
      list.append(h('div', { class: `dev-row ${s.current ? 'is-current' : ''}` },
        h('span', { class: 'dev-row__icn' }, icon(d.icn)),
        h('div', { class: 'dev-row__body' },
          h('div', { class: 'dev-row__name' }, d.name,
            s.current ? h('span', { class: 'chip is-on dev-row__chip' }, t('devThis')) : ''),
          h('div', { class: 'dev-row__meta mono' }, `${s.ip || '—'} · ${timeAgo(s.created_at, t)}`)),
        s.current ? '' : h('button', { class: 'btn btn--sm btn--danger-ghost', onclick: () => confirmBox(t('devKickConfirm'), async () => {
          try {
            await api.post('/api/admin/sessions/revoke', { created_at: s.created_at, ip: s.ip });
            toast(t('devKicked'), 'ok', 1800);
            fill();
          } catch (e) { toast(errText(e), 'err'); }
        }) }, icon('logout'), t('devKick'))));
    }
  }
  await fill();
  return card;
}

// ---------- admin: general ----------
async function generalPane() {
  let s;
  try { s = (await api.get('/api/admin/settings')).settings; } catch (e) { toast(errText(e), 'err'); return h('div'); }
  let ov;
  try { ov = (await api.get('/api/admin/overview')).overview; } catch { ov = null; }

  const pane = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });

  // the service already has a name — Cmail. the “service name” field was
  // dead weight nobody needed, so it is gone.
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

  // v3.2.2 — the fuel gauge: one D1 database is the whole disk. The card
  // speaks honestly — what is stored, split by kind, against the quota the
  // admin set; the low/full warnings live here and in the top banners.
  const storage = await storageCard();
  if (storage) pane.append(storage);

  pane.append(h('div', { class: 'glass card' },
    h('h3', { style: { margin: '0 0 12px', fontSize: '15px' } }, t('general')),
    row(t('defaultTtl'), ttl),
    row(t('maxAddresses'), maxAddr),
    row(t('sessionDays'), sess),
    row(t('retention'), ret),
    h('div', { class: 'row mt-2' },
      h('button', { class: 'btn btn--primary', onclick: async () => {
        try {
          await api.put('/api/admin/settings', {
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

// ---------- the storage card (v3.2.2): the mailbox's fuel gauge ----------
const ST_KIND_META = {
  body:    { icn: 'mail',     cls: 'k-body' },
  image:   { icn: 'image',    cls: 'k-image' },
  video:   { icn: 'film',     cls: 'k-video' },
  audio:   { icn: 'music',    cls: 'k-audio' },
  pdf:     { icn: 'pdf',      cls: 'k-pdf' },
  doc:     { icn: 'fileText', cls: 'k-doc' },
  archive: { icn: 'zip',      cls: 'k-archive' },
  other:   { icn: 'paperclip', cls: 'k-other' },
};

// the donut ring — same honest gauge family the health hero uses
function storageRing(pct, state) {
  const R = 30, C = 2 * Math.PI * R;
  const svgNS = 'http://www.w3.org/2000/svg';
  const circle = document.createElementNS(svgNS, 'circle');
  circle.setAttribute('cx', '36'); circle.setAttribute('cy', '36'); circle.setAttribute('r', String(R));
  circle.setAttribute('fill', 'none'); circle.setAttribute('stroke', 'currentColor');
  circle.setAttribute('stroke-width', '6'); circle.setAttribute('stroke-linecap', 'round');
  circle.setAttribute('stroke-dasharray', String(C));
  circle.setAttribute('stroke-dashoffset', String(C * (1 - Math.max(0, Math.min(100, pct)) / 100)));
  circle.style.transform = 'rotate(-90deg)'; circle.style.transformOrigin = 'center';
  const track = circle.cloneNode();
  track.setAttribute('stroke', 'var(--field)'); track.removeAttribute('style');
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 72 72'); svg.setAttribute('class', `st-ring st-ring--${state}`);
  svg.append(track, circle);
  const lbl = document.createElementNS(svgNS, 'text');
  lbl.setAttribute('x', '36'); lbl.setAttribute('y', '40'); lbl.setAttribute('text-anchor', 'middle');
  lbl.setAttribute('font-size', '14'); lbl.setAttribute('font-weight', '700'); lbl.setAttribute('fill', 'currentColor');
  lbl.textContent = `${lang === 'fa' ? String(Math.round(pct)).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : Math.round(pct)}٪`.replace('٪', lang === 'fa' ? '٪' : '%');
  svg.append(lbl);
  return svg;
}

async function storageCard() {
  let st;
  try { st = (await api.get('/api/storage')).storage; } catch { return null; }
  const faNum = (s) => lang === 'fa' ? String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(s);

  const state = st.full ? 'full' : st.low ? 'low' : 'ok';
  const card = h('div', { class: `glass card st-card st-card--${state}` });

  // ----- head: icon · title · state chip -----
  card.append(h('div', { class: 'st-card__head' },
    h('h3', { style: { margin: 0, fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' } }, icon('database'), t('storageTitle')),
    h('span', { class: `chip ${st.full ? 'chip--warn' : st.low ? 'chip--warn' : 'is-on'}` },
      st.full ? t('storageStateFull') : st.low ? t('storageStateLow') : t('storageStateOk'))));

  // ----- the honest warning strip (the user's exact ask) -----
  if (st.low || st.full) {
    card.append(h('div', { class: `st-warn ${st.full ? 'st-warn--full' : ''}` },
      icon(st.full ? 'alarm' : 'leaf'),
      h('span', {}, st.full ? t('storageFullWarn') : t('storageLowWarn'))));
  }

  // ----- gauge row: ring + numbers -----
  const used = fmtBytes(st.used_bytes);
  const quota = fmtBytes(st.quota_bytes);
  const gauge = h('div', { class: 'st-gauge' },
    storageRing(st.pct, state),
    h('div', { class: 'grow' },
      h('div', { class: 'st-gauge__n' }, h('b', {}, used), h('span', { class: 'muted' }, ` ${t('storageOf')} ${quota}`)),
      h('div', { class: 'small muted' }, t('storageD1Note')),
      h('div', { class: 'st-gauge__meta' },
        h('span', {}, `${faNum(st.emails)} ${t('navMail')}`),
        h('span', {}, `${faNum(st.stored_attachments)} ${t('attachTitle')}`))));

  // ----- the segmented bar: every kind in its own color -----
  const kinds = st.kinds ?? [];
  if (kinds.length && st.used_bytes > 0) {
    const bar = h('div', { class: 'st-bar', role: 'img', 'aria-label': t('storageTitle') });
    for (const k of kinds) {
      const share = Math.max(2, (k.bytes / st.used_bytes) * 100);
      bar.append(h('span', { class: `st-bar__seg ${ST_KIND_META[k.kind]?.cls ?? 'k-other'}`, style: { width: `${share}%` }, title: `${t('stKind_' + k.kind)} · ${fmtBytes(k.bytes)}` }, ''));
    }
    gauge.append(bar);
  }
  card.append(gauge);

  // ----- per-kind rows -----
  if (kinds.length) {
    const rows = h('div', { class: 'st-kinds' });
    for (const k of kinds) {
      const meta = ST_KIND_META[k.kind] ?? ST_KIND_META.other;
      rows.append(h('div', { class: 'st-kind' },
        h('span', { class: `st-kind__icn ${meta.cls}` }, icon(meta.icn)),
        h('b', {}, t('stKind_' + k.kind)),
        h('span', { class: 'small muted' }, `${faNum(k.count)} ×`),
        h('span', { style: { flex: '1' } }),
        h('b', { class: 'mono' }, fmtBytes(k.bytes)),
        h('span', { class: 'small muted mono st-kind__pct' }, `${faNum(st.used_bytes ? Math.round((k.bytes / st.used_bytes) * 100) : 0)}%`)));
    }
    card.append(rows);
  }

  // ----- controls: quota · auto-clean · one-press cleanup -----
  const quotaIn = h('input', { class: 'input ltr', type: 'number', min: 10, max: 10000, value: String(st.quota_mb) });
  const autoBtn = h('button', { class: `chip ${st.auto_clean ? 'is-on' : ''}`, role: 'switch', 'aria-checked': st.auto_clean ? 'true' : 'false' },
    st.auto_clean ? icon('check') : icon('x'), t('storageAutoClean'));
  autoBtn.addEventListener('click', async () => {
    try {
      const r = await api.post('/api/storage/autoclean', { on: !st.auto_clean });
      st.auto_clean = r.auto_clean;
      autoBtn.classList.toggle('is-on', st.auto_clean);
      autoBtn.setAttribute('aria-checked', st.auto_clean ? 'true' : 'false');
      clear(autoBtn).append(st.auto_clean ? icon('check') : icon('x'), t('storageAutoClean'));
      toast(t('settingsSaved'), 'ok', 1200);
    } catch (e) { toast(errText(e), 'err'); }
  });
  const cleanBtn = h('button', { class: 'btn btn--sm' }, icon('trash'), t('storageCleanNow'));
  cleanBtn.addEventListener('click', async () => {
    cleanBtn.disabled = true;
    try {
      const r = await api.post('/api/storage/clean');
      toast(r.deleted > 0 ? t('storageCleaned').replace('{n}', faNum(r.deleted)).replace('{s}', fmtBytes(r.freed)) : t('storageCleanNone'), 'ok', 3000);
      const fresh = await storageCard();
      if (fresh) card.replaceWith(fresh);
    } catch (e) { toast(errText(e), 'err'); cleanBtn.disabled = false; }
  });

  card.append(h('div', { class: 'st-controls' },
    h('div', { class: 'set-row' }, h('div', { class: 'set-row__t' }, t('storageQuota')), h('div', { class: 'row', style: { gap: '6px', width: '190px' } }, quotaIn,
      h('button', { class: 'btn btn--sm btn--primary', onclick: async () => {
        try { await api.post('/api/storage/quota', { quota_mb: +quotaIn.value }); toast(t('settingsSaved'), 'ok', 1200); const fresh = await storageCard(); if (fresh) card.replaceWith(fresh); }
        catch (e) { toast(errText(e), 'err'); }
      } }, t('save')))),
    h('div', { class: 'set-row' }, h('div', { class: 'set-row__t' }, t('storageAutoCleanT'), h('div', { class: 'small muted' }, t('storageAutoCleanD'))), autoBtn),
    h('div', { class: 'set-row' }, h('div', { class: 'set-row__t' }, t('storageManualT'), h('div', { class: 'small muted' }, t('storageManualD'))), cleanBtn)));

  // ----- last auto-clean memory -----
  if (st.last_cleanup?.at) {
    card.append(h('div', { class: 'small muted st-last' }, icon('clock'),
      ' ', t('storageLastClean').replace('{n}', faNum(st.last_cleanup.deleted)).replace('{s}', fmtBytes(st.last_cleanup.freed)).replace('{w}', timeAgo(st.last_cleanup.at, t))));
  }

  // ----- the biggest letters — the honest way to take out the trash -----
  if ((st.biggest ?? []).length) {
    const list = h('div', { class: 'st-big' }, h('div', { class: 'small muted st-big__t' }, t('storageBiggest')));
    for (const m of st.biggest) {
      list.append(h('div', { class: 'st-big__row' },
        h('span', { class: 'st-big__subj' }, m.subject || '(no subject)'),
        h('span', { class: 'small muted mono' }, fmtBytes(m.size)),
        h('button', { class: 'icon-btn', title: t('openMail'), 'aria-label': t('openMail'), onclick: () => { location.hash = `#/mail/m/${m.id}`; } }, icon('external')),
        h('button', { class: 'icon-btn', title: t('delete'), 'aria-label': t('delete'), onclick: () => confirmBox(t('delOneConfirm'), async () => {
          try {
            await api.del(`/api/emails/${m.id}`);
            const fresh = await storageCard();
            if (fresh) card.replaceWith(fresh);
            toast(t('deletedN'), 'ok', 1400);
          } catch (e) { toast(errText(e), 'err'); }
        }) }, icon('trash'))));
    }
    card.append(list);
  }
  return card;
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

  // the live state of outgoing mail, visible before reading a single field:
  // a warm open-shackle chip once a provider is configured, an icy frozen
  // lock while the compose button stays locked everywhere else
  const connected = s.sending_provider && s.sending_provider !== 'none';
  const stateChip = connected
    ? h('span', { class: 'chip is-on' }, icon('lockOpen'), t('sendOpenTitle'))
    : h('span', { class: 'chip' }, icon('lock'), t('sendLockedTitle'));

  return h('div', { class: 'glass card' },
    h('h3', { style: { margin: '0 0 10px', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, t('sending'), stateChip),
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
