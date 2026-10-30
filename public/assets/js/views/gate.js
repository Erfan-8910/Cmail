// Cmail — setup gate: nothing opens until every prerequisite is connected.
// Shows live status, a progress ring, and a complete fix-guide for each missing piece.
import { api, state, errText } from '../api.js';
import { t, lang, setLang } from '../i18n.js';
import { h, clear, icon, toast, copyText, vibrate } from '../ui.js';
import { setTheme } from '../app.js';
import { copyLine, dnsTable } from './auth.js';

const RECHECK_EVERY = 20; // seconds (auto re-check for members)

export async function renderGate(root) {
  let offline = !state.setup;
  let timer = null;
  let count = RECHECK_EVERY;

  clear(root);
  const view = h('div', { class: 'view view--auth' });
  const ctrls = h('div', { class: 'auth-ctrls' },
    h('button', { class: 'glass-btn', title: t('theme'), onclick: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') }, icon('sun')),
    h('button', { class: 'glass-btn', title: t('language'), onclick: () => { setLang(lang === 'fa' ? 'en' : 'fa'); renderGate(root); } }, icon('globe')),
  );
  view.append(ctrls);
  const gate = h('div', { class: 'gate' });
  view.append(gate);
  root.append(view);

  // ---------- pieces ----------
  const ring = buildRing();
  const ringVal = ring.value;

  const head = h('header', { class: 'gate__head' },
    h('img', { class: 'gate__logo', src: 'assets/img/logo-dark.png', alt: 'Cmail' }),
    h('div', { class: 'gate__eyebrow' },
      h('span', { class: 'gate__dot', id: 'gate-dot' }),
      h('span', { id: 'gate-eyebrow' }, t('gateChecking'))),
    h('h1', { class: 'gate__title' }, t('gateTitle')),
    h('p', { class: 'gate__sub' }, t('gateSub')),
  );

  const card = h('section', { class: 'gate__card glass' });
  gate.append(head, card);

  // ---------- terminal / step helpers ----------
  const term = (cmd) => h('div', { class: 'term' },
    h('span', { class: 'term__sign' }, '$'),
    h('code', {}, cmd),
    h('button', { class: 'term__copy', title: t('copy'), onclick: async () => { await copyText(cmd); toast(t('copied'), 'ok', 1400); } }, icon('copy')));

  const step = (n, node) => h('div', { class: 'tut__step' }, h('span', { class: 'tut__n' }, String(n)), h('div', { class: 'tut__step-b' }, node));

  const tutPanel = (title, iconName, ...children) => h('div', { class: 'tut' },
    h('div', { class: 'tut__head' }, icon(iconName), h('b', {}, title)),
    ...children);

  // ---------- tutorials ----------
  // database: three shapes — no binding yet / binding ok, tables missing / all good
  function tutBinding() {
    return tutPanel(t('tutDbTitle'), 'database',
      step(1, t('bind1')),
      step(2, t('bind2')),
      step(3, t('bind3')),
      step(4, h('div', {}, t('bind4'), term('npx wrangler d1 create cmail-db'))),
    );
  }

  function tutInit() {
    const btn = h('button', { class: 'btn btn--primary init-cta', type: 'button' }, icon('database'), h('span', {}, t('initBtn')));
    const st = h('span', { class: 'init-st' });
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.classList.add('is-busy');
      st.textContent = t('initRunning');
      try {
        await api.post('/api/setup/init', {});
        st.textContent = '';
        toast(t('initDone'), 'ok', 2000);
        await recheck(true);
      } catch (err) {
        btn.disabled = false;
        btn.classList.remove('is-busy');
        st.textContent = '';
        toast(errText(err), 'err');
      }
    });
    return tutPanel(t('initTitle'), 'database',
      h('p', { class: 'tut__d' }, t('initDesc')),
      h('div', { class: 'tut__cta init-row' }, btn, st),
      h('details', { class: 'tut__manual' },
        h('summary', {}, t('initManual')),
        step(1, h('div', {}, t('initManualD'), term('npx wrangler d1 execute cmail-db --remote --file=schema.sql'))),
        step(2, t('initManual2'))),
    );
  }

  function tutDatabase() {
    const s = state.setup || {};
    if (!s.db_binding) return tutBinding();
    if (!s.tables) return tutInit();
    return tutPanel(t('tutDbTitle'), 'database', h('p', { class: 'tut__d' }, t('checkDatabaseD')));
  }

  function tutAdmin() {
    return tutPanel(t('tutAdminTitle'), 'user',
      h('p', { class: 'tut__d' }, t('tutAdminD')),
      h('div', { class: 'tut__cta' },
        h('button', { class: 'btn btn--primary', onclick: () => { location.hash = '#/login'; } },
          icon('arrow'), state.setup?.admin_created && !state.user ? t('login') : t('goMakeAccess'))));
  }

  function tutDomain() {
    const inp = h('input', { class: 'input ltr', placeholder: 'mail.example.com', inputmode: 'url' });
    const btn = h('button', { class: 'btn btn--primary' }, icon('plus'), t('addDomain'));
    const form = h('form', { class: 'gate__inline' },
      h('div', { class: 'field grow' }, h('label', {}, t('domainName')), inp), btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        await api.post('/api/setup/domain', { name: inp.value.trim().toLowerCase() });
        toast(t('saved'), 'ok', 1600);
        await recheck();
      } catch (err) { toast(errText(err), 'err'); btn.disabled = false; }
    });
    return tutPanel(t('tutDomainTitle'), 'globe',
      form,
      step(1, t('tutDomain1')),
      step(2, t('tutDomain2')),
      step(3, t('tutDomain3')),
      step(4, t('tutDomain4')),
      h('div', { class: 'tut__dns' },
        dnsTable([
          ['MX', '@', 'route1.mx.cloudflare.net', '10'],
          ['MX', '@', 'route2.mx.cloudflare.net', '20'],
          ['MX', '@', 'route3.mx.cloudflare.net', '30'],
        ]),
        copyLine('v=spf1 include:_spf.mx.cloudflare.net ~all')),
    );
  }

  function tutSending() {
    const prov = h('select', { class: 'input' },
      h('option', { value: 'brevo' }, 'Brevo — 300/day free'),
      h('option', { value: 'resend' }, 'Resend — 100/day free'));
    const key = h('input', { class: 'input ltr', placeholder: 'xkeysib-… / re_…', autocomplete: 'off' });
    const from = h('input', { class: 'input ltr', placeholder: 'no-reply@yourdomain.com' });
    const btn = h('button', { class: 'btn btn--primary' }, icon('check'), t('save'));
    const form = h('form', { class: 'gate__form' },
      h('div', { class: 'field' }, h('label', {}, t('provider')), prov),
      h('div', { class: 'field' }, h('label', {}, t('apiKey')), key),
      h('div', { class: 'field' }, h('label', {}, t('fromEmail')), from),
      btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        await api.put('/api/admin/settings', {
          sending_provider: prov.value,
          sending_api_key: key.value.trim(),
          sending_from_email: from.value.trim(),
        });
        toast(t('saved'), 'ok', 1600);
        await recheck();
      } catch (err) { toast(errText(err), 'err'); btn.disabled = false; }
    });
    return tutPanel(t('tutSendingTitle'), 'send',
      step(1, t('tutSending1')),
      step(2, h('div', {}, t('tutSending2'), form)),
      step(3, t('tutSending3')),
    );
  }

  const isAdmin = () => !!state.user && state.user.role === 'admin';
  const tutorials = {
    database: tutDatabase,
    admin: tutAdmin,
    domain: tutDomain,
    sending: tutSending,
  };

  function memberNote() {
    const kids = [h('p', { class: 'tut__d' }, t('gateAdminNote'))];
    if (!state.user && state.setup?.admin_created) {
      kids.push(h('div', { class: 'tut__cta' },
        h('button', { class: 'btn btn--primary', onclick: () => { location.hash = '#/login'; } }, icon('arrow'), t('login'))));
    }
    return h('div', { class: 'tut' },
      h('div', { class: 'tut__head' }, icon('info'), h('b', {}, t('gateTitle'))),
      ...kids);
  }

  // ---------- check rows ----------
  const CHECKS = [
    { id: 'database', name: () => t('checkDatabase'), desc: () => t('checkDatabaseD'), icn: 'database' },
    { id: 'admin', name: () => t('checkAdmin'), desc: () => t('checkAdminD'), icn: 'user' },
    { id: 'domain', name: () => t('checkDomain'), desc: () => t('checkDomainD'), icn: 'globe' },
    { id: 'sending', name: () => t('checkSending'), desc: () => t('checkSendingD'), icn: 'send' },
  ];

  function buildRing() {
    const R = 30, C = 2 * Math.PI * R;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '38'); circle.setAttribute('cy', '38'); circle.setAttribute('r', String(R));
    circle.setAttribute('fill', 'none'); circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', '6'); circle.setAttribute('stroke-linecap', 'round');
    circle.setAttribute('stroke-dasharray', String(C)); circle.setAttribute('stroke-dashoffset', String(C));
    circle.style.transform = 'rotate(-90deg)'; circle.style.transformOrigin = 'center';
    const track = circle.cloneNode();
    track.setAttribute('stroke', 'var(--field)'); track.removeAttribute('style');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 76 76'); svg.setAttribute('class', 'ring__svg');
    svg.append(track, circle);
    const val = h('div', { class: 'ring__val' }, '—');
    const wrap = h('div', { class: 'ring' }, svg, val);
    return { el: wrap, set(pct, label) {
      circle.style.strokeDashoffset = String(C * (1 - pct));
      val.textContent = label;
    } };
  }

  function checkRow(def, i) {
    const status = () => state.setup?.checks?.find((x) => x.id === def.id)?.ok;
    const pill = h('span', { class: 'check__pill' }, t('gateWaiting'));
    const icn = h('span', { class: 'check__icn' }, icon(def.icn));
    const row = h('div', { class: 'check', style: { animationDelay: `${i * 90}ms` } },
      icn,
      h('div', { class: 'check__txt' }, h('b', {}, def.name()), h('span', {}, def.desc())),
      pill);
    const tutBox = h('div', { class: 'check__tut', style: { display: 'none' } });
    return { row, tutBox, def,
      refresh(animate) {
        const st = offline ? false : status();
        row.classList.toggle('is-ok', st === true);
        row.classList.toggle('is-bad', st === false);
        row.classList.toggle('is-unk', st == null);
        pill.textContent = st == null ? t('gateWaiting') : st ? t('gateConnected') : t('gateNotConnected');
        if (st === false) {
          icn.innerHTML = icon(def.icn).innerHTML;
          // the database step is public on purpose: a fresh deployment has no
          // session yet, and the one-click table setup must be reachable then.
          const body = isAdmin() || def.id === 'database'
            ? tutorials[def.id]?.() ?? memberNote()
            : memberNote();
          clear(tutBox).append(body);
          tutBox.style.display = '';
        } else {
          tutBox.style.display = 'none';
          clear(tutBox);
        }
        if (animate && st !== null) {
          row.classList.remove('pop'); void row.offsetWidth; row.classList.add('pop');
        }
      } };
  }

  const rows = CHECKS.map(checkRow);
  const checksBox = h('div', { class: 'gate__checks' }, rows.map((r) => [r.row, r.tutBox]).flat());

  // recheck button + auto label
  const reBtn = h('button', { class: 'btn btn--primary', onclick: () => recheck(true) }, icon('refresh'), t('gateRecheck'));
  const autoLbl = h('span', { class: 'gate__auto' });

  // ---------- draw ----------
  function drawCard() {
    clear(card);
    if (offline) { drawOffline(); return; }
    const checks = state.setup?.checks ?? [];
    const okN = checks.filter((x) => x.ok).length;
    const total = CHECKS.length;
    ring.set(okN / total, `${lang === 'fa' ? toFa(okN) : okN}`);
    const allOk = okN === total;

    const top = h('div', { class: 'gate__top' },
      ring.el,
      h('div', { class: 'gate__top-txt' },
        h('h2', {}, allOk ? t('gateAllOk') : `${okN ? (lang === 'fa' ? toFa(okN) : okN) : '—'} ${t('gateOf')} ${lang === 'fa' ? toFa(total) : total} ${lang === 'fa' ? 'اتصال برقرار است' : 'connections up'}`),
        h('p', {}, allOk ? t('gateAllOkSub') : (state.user ? t('gateHintFix') : t('gateAdminNote'))),
        h('div', { class: 'row', style: { gap: '8px', marginTop: '10px' } }, reBtn, autoLbl)));
    card.append(top, checksBox);
    rows.forEach((r) => r.refresh(false));

    if (allOk) {
      card.classList.add('is-done');
      const stay = location.hash.includes('stay');
      if (!card.dataset.celebrated) {
        card.dataset.celebrated = '1';
        celebrate();
      }
      if (stay && state.user) {
        clear(reBtn);
        reBtn.append(icon('inbox'), t('navMail'));
        reBtn.onclick = () => { location.hash = '#/mail'; };
        autoLbl.textContent = '';
      } else if (!stay) {
        setTimeout(() => { location.hash = state.user ? '#/mail' : '#/login'; }, 1500);
      }
    } else {
      card.classList.remove('is-done');
      delete card.dataset.celebrated;
    }
    updateEyebrow();
  }

  // success moment: one-shot confetti burst in accent colors
  function celebrate() {
    vibrate([10, 40, 10, 40, 18]);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#b9cda3', '#a7cbd6', '#cab6da', '#e3c795', '#93c793', '#ffffff'];
    const box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
    for (let i = 0; i < 56; i++) {
      const p = h('i');
      const round = Math.random() > .6;
      p.style.cssText =
        `left:${Math.random() * 100}vw;` +
        `background:${colors[i % colors.length]};` +
        `width:${round ? 8 : 6 + Math.random() * 4}px;height:${round ? 8 : 10 + Math.random() * 8}px;` +
        `border-radius:${round ? '50%' : '2px'};` +
        `animation-duration:${2.2 + Math.random() * 1.8}s;` +
        `animation-delay:${Math.random() * .7}s;` +
        `transform:rotate(${Math.random() * 360}deg);`;
      box.append(p);
    }
    document.body.append(box);
    setTimeout(() => box.remove(), 5200);
  }

  function drawOffline() {
    ring.set(0, '—');
    card.append(
      h('div', { class: 'gate__top' },
        h('div', { class: 'offline-icn' }, icon('globeAm')),
        h('div', { class: 'gate__top-txt' },
          h('h2', {}, t('offlineTitle')),
          h('p', {}, t('offlineD')),
          h('div', { class: 'row', style: { gap: '8px', marginTop: '10px' } }, reBtn))),
      h('div', { class: 'tut', style: { marginTop: '14px' } },
        step(1, term('cd cmail && npm run dev')),
        step(2, t('offlineStep2'))),
    );
    updateEyebrow();
  }

  function updateEyebrow() {
    const dot = document.getElementById('gate-dot');
    const lbl = document.getElementById('gate-eyebrow');
    if (!dot || !lbl) return;
    dot.classList.toggle('is-off', offline);
    lbl.textContent = offline ? t('network') : t('onlineBadge');
  }

  async function recheck(manual) {
    if (manual) { reBtn.disabled = true; reBtn.classList.add('spin'); }
    try {
      const s = await api.get('/api/setup/status');
      if (s?.ready !== undefined) state.setup = s;
      offline = false;
      if (manual) toast(t('onlineBadge'), 'ok', 1400);
    } catch {
      offline = true;
      if (manual) toast(t('network'), 'err');
    }
    if (manual) { reBtn.disabled = false; reBtn.classList.remove('spin'); }
    count = RECHECK_EVERY;
    drawCard();
  }

  // auto re-check loop
  timer = setInterval(async () => {
    if (offline) { count = RECHECK_EVERY; autoLbl.textContent = ''; return; }
    const checks = state.setup?.checks ?? [];
    if (checks.length && checks.every((x) => x.ok)) { autoLbl.textContent = ''; return; }
    count -= 1;
    autoLbl.textContent = `${t('gateAutoIn')} ${lang === 'fa' ? toFa(Math.max(count, 0)) : Math.max(count, 0)}${t('gateSeconds')}`;
    if (count <= 0) {
      count = RECHECK_EVERY;
      try {
        const s = await api.get('/api/setup/status');
        const before = JSON.stringify(state.setup?.checks ?? []);
        state.setup = s; offline = false;
        if (JSON.stringify(s.checks ?? []) !== before) drawCard();
      } catch { offline = true; drawCard(); }
    }
  }, 1000);

  // first paint: staggered
  drawCard();
  if (!state.setup) await recheck(false);
}

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
function toFa(n) { return String(n).replace(/\d/g, (d) => FA_DIGITS[+d]); }
