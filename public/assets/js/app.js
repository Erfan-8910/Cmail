// Cmail — app shell: boot, router, floating pill navigation + account switcher
import { api, state, errText } from './api.js';
import { t, setLang, lang } from './i18n.js';
import { h, clear, icon, toast, vibrate, avatarColor } from './ui.js';
import { openCmdk, closeCmdk, cmdkIsOpen, cmdkKey } from './cmdk.js';
import { renderLogin } from './views/auth.js';
import { renderGate } from './views/gate.js';
import { renderMail, createAddressModal } from './views/mail.js';
import { renderAddresses } from './views/addresses.js';
import { renderVault } from './views/vault.js';
import { renderDomains } from './views/domains.js';
import { renderSettings } from './views/settings.js';
import { renderAbout } from './views/about.js';
import { renderHelp } from './views/help.js';
import { renderInto as renderAlerts } from './health.js';

const app = document.getElementById('app');
const pillbar = document.getElementById('pillbar');
const pbNav = document.getElementById('pb-nav');
const pbEnd = document.getElementById('pb-end');
const pbVer = document.getElementById('pb-ver');
const tabbar = document.getElementById('tabbar');
const tabbarIn = document.getElementById('tabbar-in');

// ---------- routing ----------
const routes = {
  mail: renderMail,
  addresses: renderAddresses,
  vault: renderVault,
  domains: renderDomains,
  settings: renderSettings,
  about: renderAbout,
  help: renderHelp,
  login: renderLogin,
  status: renderGate,
};

export function nav(hash) { location.hash = hash; }

function currentRoute() {
  const raw = (location.hash || '').replace(/^#\//, '').split('?')[0];
  const [page, ...rest] = raw.split('/');
  return { page: page || '', arg: rest.join('/') };
}

async function route() {
  const { page } = currentRoute();

  // fetch system status (may be offline); always fresh on gate entry
  if (!state.setup || page === 'status' || page === 'login') {
    try { state.setup = await api.get('/api/setup/status'); }
    catch { if (!state.setup) state.setup = null; }
    // the status endpoint self-heals the single user's admin role — pick up
    // the fresh role right away so admin surfaces unlock without a re-login
    if (state.setup && state.user) {
      try { const me = await api.get('/api/auth/me'); if (me?.user) state.user = me.user; } catch { /* */ }
    }
  }
  const ready = !!state.setup?.ready;

  // GATE — the main app stays closed until every prerequisite is connected.
  // A fresh install lands on the setup screen itself: the D1 step comes
  // before the username form. Once the tables exist, the sign-in page is
  // reachable normally and the gate handles the remaining steps (domain…).
  if (!ready) {
    const dbPending = !!state.setup && !state.setup.tables;
    const allowed = page === 'status' || (page === 'login' && !dbPending);
    if (!allowed) { location.hash = '#/status'; return; }
  } else if (page === 'status' && !location.hash.includes('stay')) {
    location.hash = state.user ? '#/mail' : '#/login'; return;
  }

  const needsAuth = page !== 'login' && page !== 'status';
  if (needsAuth && !state.user) { location.hash = '#/login'; return; }
  if (page === 'login' && state.user) { location.hash = ready ? '#/mail' : '#/status'; return; }

  const authView = page === 'login' || page === 'status';
  renderShell(page, authView);
  clear(app);
  window.scrollTo({ top: 0 });

  // serious system issues (D1 down, tables missing, schema old, mail stalled)
  // show as banners above the content — admins only, cached for a minute
  const alertHost = document.getElementById('sysalert');
  if (alertHost) {
    if (!authView && state.user?.role === 'admin') {
      await renderAlerts(alertHost);
      document.body.classList.toggle('has-alert', !alertHost.hidden && alertHost.children.length > 0);
    } else {
      alertHost.hidden = true; clear(alertHost);
      document.body.classList.remove('has-alert');
    }
  }

  if (authView) {
    app.className = 'view view--auth';
    if (page === 'login') return renderLogin(app);
    return renderGate(app);
  }

  app.className = 'view';
  const view = routes[page] ?? renderMail;
  try {
    await view(app, currentRoute().arg);
  } catch (e) {
    if (e.code === 'unauthorized') return;
    toast(errText(e), 'err');
    app.append(h('div', { class: 'empty' }, h('div', { class: 'empty__t' }, t('error')), h('div', { class: 'empty__d' }, e.message ?? '')));
  }
}

// ---------- shell: floating pill navigation + mobile tabbar ----------
function navItems() {
  const items = [
    { key: 'mail', icon: 'inbox', label: t('navMail'), href: '#/mail' },
    { key: 'addresses', icon: 'mail', label: t('navAddresses'), href: '#/addresses' },
    { key: 'vault', icon: 'key', label: t('navVault'), href: '#/vault' },
    { key: 'help', icon: 'help', label: t('navHelp'), href: '#/help' },
  ];
  return items;
}

function tabItems() {
  return [
    { key: 'mail', icon: 'inbox', label: t('navMail') },
    { key: 'addresses', icon: 'mail', label: t('navAddresses') },
    { key: 'vault', icon: 'key', label: t('navVault') },
    { key: 'about', icon: 'heart', label: t('navAbout') },
    { key: 'settings', icon: 'settings', label: t('navSettings') },
  ];
}

function renderShell(page, authView) {
  [pillbar, tabbar].forEach((el) => { el.hidden = authView; });
  document.body.classList.toggle('is-auth', authView);
  if (authView) return;

  // version chip lives on the brand — refresh it from the server status
  if (pbVer && state.setup?.version) pbVer.textContent = state.setup.version.split('.').slice(0, 2).join('.');

  // ----- page pills -----
  clear(pbNav);
  for (const it of navItems()) {
    pbNav.append(h('a', {
      class: `pill-nav ${page === it.key ? 'is-on' : ''}`,
      href: it.href,
      dataset: { nav: it.key },
    }, icon(it.icon), h('span', {}, it.label), it.key === 'mail' ? h('span', { class: 'badge', id: 'pill-unread', style: { display: state.unread > 0 ? '' : 'none' } }, state.unread > 99 ? '99+' : String(state.unread)) : ''));
  }

  // ----- end controls: search · theme · language · account -----
  clear(pbEnd);
  pbEnd.append(
    h('button', { class: 'spot-pill', title: t('searchMail'), 'aria-label': t('searchMail'), onclick: () => openCmdk() },
      icon('search'), h('span', { class: 't' }, t('searchMail')), h('kbd', { class: 'kbd' }, isMac() ? '⌘K' : 'Ctrl K')),
    h('span', { class: 'pillbar__sep' }),
    h('button', { class: 'icon-btn', title: t('theme'), 'aria-label': t('theme'), onclick: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') }, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')),
    h('button', { class: 'icon-btn', title: t('language'), 'aria-label': t('language'), onclick: () => { setLang(lang === 'fa' ? 'en' : 'fa'); route(); } }, icon('globe')),
  );
  const userWrap = h('div', { style: { position: 'relative', display: 'inline-flex' } });
  userWrap.append(h('button', { class: 'avatar', id: 'acct-avatar', 'aria-label': t('account'), title: t('account'), onclick: (e) => { e.stopPropagation(); openSwitcher(userWrap); } }, activeAvatarLetter()));
  pbEnd.append(userWrap);

  // ----- mobile tabbar -----
  clear(tabbarIn);
  for (const it of tabItems()) {
    tabbarIn.append(h('a', {
      class: `tab ${page === it.key ? 'is-on' : ''}`,
      href: `#/${it.key}`,
      dataset: { tab: it.key },
    }, icon(it.icon), h('span', {}, it.label), it.key === 'mail' ? h('span', { class: 'badge', id: 'tab-unread', style: { display: state.unread > 0 ? '' : 'none' } }, state.unread > 99 ? '99+' : String(state.unread)) : ''));
  }
}

function isMac() { return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent); }

// ---------- account switcher — every mailbox is its own account ----------
// The circle at the top works exactly like the big clients: open it, glance
// at the tiny details of every account (mail count, unread, 2FA codes),
// jump into one, add another — never leaving the page you were on.
let acctCache = null;
let acctCacheAt = 0;
let acctMenuEl = null;

function activeAccount() {
  const list = state.addresses ?? [];
  return list.find((a) => a.id === state.currentAddressId) ?? null;
}

function activeAvatarLetter() {
  const a = activeAccount();
  return (a ? (a.label || a.address) : (state.user?.username ?? '?')).slice(0, 1).toUpperCase();
}

export async function switchAccount(id) {
  closeSwitcher();
  const changed = state.currentAddressId !== id;
  state.currentAddressId = id;
  localStorage.setItem('cmail_acct', id ?? '');
  vibrate(6);
  if (changed) {
    state.unread = (state.addresses ?? []).find((a) => a.id === id)?.unread ?? state.unread;
    updateUnreadBadge();
  }
  // repaint the avatar letter, then land on the mail space of that account
  const av = document.getElementById('acct-avatar');
  if (av) av.textContent = activeAvatarLetter();
  const { page } = currentRoute();
  if (page === 'mail') route();
  else location.hash = '#/mail';
}

async function accountsData() {
  if (acctCache && Date.now() - acctCacheAt < 30_000) return acctCache;
  try {
    const [ar, tr] = await Promise.all([
      api.get('/api/addresses'),
      api.get('/api/totp').catch(() => ({ entries: [] })),
    ]);
    state.addresses = ar.addresses ?? [];
    const codes = {};
    for (const e of (tr.entries ?? [])) {
      if (!e.address_id) continue;
      codes[e.address_id] = (codes[e.address_id] ?? 0) + 1;
    }
    acctCache = { list: state.addresses, codes };
    acctCacheAt = Date.now();
  } catch { return { list: state.addresses ?? [], codes: {} }; }
  return acctCache;
}

export function invalidateAccounts() { acctCache = null; acctCacheAt = 0; }

async function openSwitcher(anchor) {
  if (acctMenuEl) { closeSwitcher(); return; }
  vibrate(5);
  const menu = h('div', { class: 'acct-menu', role: 'menu', 'aria-label': t('account') });
  acctMenuEl = menu;

  // ----- header: who is signed in + which account is live -----
  const active = activeAccount();
  const head = h('div', { class: 'acct-menu__head' },
    h('span', { class: 'avatar', style: { background: active ? avatarColor(active.address) : 'var(--acc)' } }, activeAvatarLetter()),
    h('div', { class: 'acct-menu__id' },
      h('div', { class: 'acct-menu__name' }, state.user?.display_name || state.user?.username || '—'),
      h('div', { class: 'acct-menu__sub' },
        h('span', {}, state.user?.role === 'admin' ? t('roleAdmin') : t('roleMember')),
        active ? h('span', { class: 'mono', style: { fontSize: '10.5px' } }, active.address) : '')));
  menu.append(head);

  // ----- account rows (filled once the stats land) -----
  const label = h('div', { class: 'acct-menu__label' }, t('yourAccounts'));
  const listBox = h('div', { class: 'acct-menu__list' });
  menu.append(label, listBox);

  // ----- add another account -----
  menu.append(h('button', { class: 'acct-menu__add', onclick: async () => { closeSwitcher(); await createAddressModal(() => { invalidateAccounts(); route(); }); } },
    icon('plus'), h('span', {}, t('acctNew'))));

  // ----- footer: manage / settings / about / sign out -----
  const foot = h('div', { class: 'acct-menu__foot' });
  const footBtn = (icn, lbl, fn, cls = '') => {
    const b = h('button', { class: cls, onclick: () => { closeSwitcher(); fn(); } }, icon(icn), h('span', {}, lbl));
    return b;
  };
  foot.append(
    footBtn('inbox', t('navAddresses'), () => nav('/addresses')),
    state.user?.role === 'admin' ? footBtn('globe', t('navDomains'), () => nav('/domains')) : '',
    footBtn('settings', t('navSettings'), () => nav('/settings')),
    footBtn('heart', t('navAbout'), () => nav('/about')),
    footBtn('logout', t('logout'), async () => { await api.post('/api/auth/logout').catch(() => {}); state.user = null; nav('/login'); }, 'is-danger'),
  );
  menu.append(foot);

  document.body.append(menu);

  // ----- position under the avatar circle, clamped to the viewport -----
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const top = Math.min(r.bottom + 10, window.innerHeight - mh - 10);
    menu.style.top = `${Math.max(10, top)}px`;
    if (document.documentElement.dir === 'rtl') {
      menu.style.left = `${Math.max(9, Math.min(r.left, window.innerWidth - mw - 9))}px`;
      menu.style.right = 'auto';
    } else {
      menu.style.right = `${Math.max(9, Math.min(window.innerWidth - r.right, window.innerWidth - mw - 9))}px`;
      menu.style.left = 'auto';
    }
  };
  place();
  const off = (e) => { if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeSwitcher(); };
  setTimeout(() => document.addEventListener('click', off), 0);
  window.addEventListener('resize', closeSwitcher, { once: true });

  // ----- fill the rows with the live per-account details -----
  const { list, codes } = await accountsData();
  if (acctMenuEl !== menu) return; // closed while loading
  clear(listBox);
  if (!list.length) {
    listBox.append(h('div', { class: 'small muted', style: { padding: '10px 12px 14px', textAlign: 'center' } }, t('noAccountsYet')));
    label.style.display = 'none';
  } else {
    label.style.display = '';
    for (const a of list) {
      const isActive = a.id === state.currentAddressId;
      const nCodes = codes[a.id] ?? 0;
      const row = h('button', {
        class: `acct-row ${isActive ? 'is-on' : ''}`,
        onclick: () => switchAccount(a.id),
      },
        h('span', { class: 'acct-row__ava', style: { background: avatarColor(a.address) } }, (a.label || a.address).slice(0, 1).toUpperCase()),
        h('span', { class: 'acct-row__body' },
          h('span', { class: 'acct-row__addr' }, a.address),
          h('span', { class: 'acct-row__meta' },
            h('span', {}, icon('mail'), h('b', {}, String(a.total ?? 0)), ' ' + t('acctMails')),
            h('span', {}, icon('key'), h('b', {}, String(nCodes)), ' ' + t('acctCodes')))),
        h('span', { class: 'acct-row__end' },
          a.unread > 0 ? h('span', { class: 'acct-row__badge' }, a.unread > 99 ? '99+' : String(a.unread)) : '',
          isActive ? h('span', { class: 'acct-row__check' }, icon('check')) : ''));
      listBox.append(row);
    }
  }
  place();
}

function closeSwitcher() {
  if (acctMenuEl) { acctMenuEl.remove(); acctMenuEl = null; }
}

// ---------- theme & accent ----------
const MOOD_META = {
  sage: { dark: '#161c17', light: '#f3f6ef' },
  serene: { dark: '#131b21', light: '#eff4f6' },
  violet: { dark: '#181522', light: '#f4f1f7' },
  amber: { dark: '#1d1812', light: '#f7f3ea' },
};

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('cmail_theme', theme);
  const mood = document.documentElement.dataset.accent || 'sage';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', (MOOD_META[mood] ?? MOOD_META.sage)[theme === 'dark' ? 'dark' : 'light']);
  // refresh icons that depend on theme
  if (!pillbar.hidden) {
    const btn = pbEnd?.querySelector('.icon-btn');
    if (btn) btn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon').innerHTML;
  }
}

export function setAccent(accent) {
  document.documentElement.dataset.accent = accent;
  localStorage.setItem('cmail_accent', accent);
  const theme = document.documentElement.dataset.theme || 'dark';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', (MOOD_META[accent] ?? MOOD_META.sage)[theme === 'dark' ? 'dark' : 'light']);
}

// the ambient stage behind the whole app: aurora (alive) · halo (still) · pure (flat)
export function setBg(mode) {
  document.documentElement.dataset.bg = mode;
  localStorage.setItem('cmail_bg', mode);
}

// ---------- session keepalive (refresh unread badge + new-mail notify) ----------
setInterval(async () => {
  if (!state.user || pillbar.hidden) return;
  try {
    const r = await api.get('/api/auth/me');
    state.user = r.user;
    if (r.unread !== state.unread) {
      const grew = state.unread > 0 && r.unread > state.unread;
      state.unread = r.unread;
      updateUnreadBadge();
      if (grew) toast(t('newMailToast'), 'ok', 3200);
    }
  } catch { /* silent */ }
}, 20_000);

export function updateUnreadBadge() {
  const show = state.unread > 0;
  const txt = state.unread > 99 ? '99+' : String(state.unread);
  for (const id of ['pill-unread', 'tab-unread']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = txt;
    el.style.display = show ? '' : 'none';
    if (show) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  }
}

// ---------- boot ----------
(async function boot() {
  setTheme(localStorage.getItem('cmail_theme') ?? 'dark');
  // old builds shipped other accent names — fold them into the four moods
  const LEGACY = { emerald: 'serene', ocean: 'serene', blue: 'serene', midnight: 'serene', ice: 'serene', sakura: 'violet', rose: 'violet', wine: 'violet', coral: 'violet', gold: 'amber' };
  const savedAccent = localStorage.getItem('cmail_accent') ?? 'sage';
  setAccent(LEGACY[savedAccent] ?? savedAccent);
  document.documentElement.dataset.bg = localStorage.getItem('cmail_bg') ?? 'aurora';

  window.addEventListener('cmail:unauthorized', () => {
    state.user = null;
    if (!location.hash.startsWith('#/login')) { toast(t('invalidCredentials'), 'err'); location.hash = '#/login'; }
  });
  window.addEventListener('cmail:rerender', () => { if (!location.hash.includes('/status')) route(); });
  window.addEventListener('cmail:unread-changed', (e) => { state.unread = e.detail ?? 0; updateUnreadBadge(); });
  window.addEventListener('hashchange', () => { closeSwitcher(); route(); });

  // ⌘K / Ctrl+K — command palette · “/” focus mail search
  const kbdHandler = (e) => {
    if (e.key === 'Escape' && acctMenuEl) { closeSwitcher(); return; }
    const t = e.target;
    const typing = t && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable);
    const fromOuterDoc = t?.ownerDocument && t.ownerDocument !== document;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); back_open_or_close(); return; }
    if (cmdkIsOpen() && fromOuterDoc && cmdkKey(e)) return;
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    // plain keys pressed on the embedding page → forward into the app
    if (fromOuterDoc) {
      try { document.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true, cancelable: true })); } catch { /* */ }
      return;
    }
    if (e.key === '/' && document.getElementById('email-list')) {
      e.preventDefault();
      document.querySelector('.mail__search')?.focus();
    }
  };
  document.addEventListener('keydown', kbdHandler);
  // also listen on the embedding page so ⌘K works before the iframe is focused
  if (window.parent && window.parent !== window) {
    try { window.parent.document.addEventListener('keydown', kbdHandler); } catch { /* cross-origin */ }
  }
  function back_open_or_close() { if (document.querySelector('.cmdk-back')) closeCmdk(); else openCmdk(); }

  // silent session check
  try {
    const me = await api.get('/api/auth/me');
    state.user = me.user;
    state.unread = me.unread ?? 0;
  } catch { state.user = null; }

  if (!location.hash) location.hash = state.user ? '#/mail' : '#/login';
  await route();
  updateUnreadBadge();
})();
