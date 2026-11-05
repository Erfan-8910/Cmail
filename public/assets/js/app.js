// Cmail — app shell: boot, router, sidebar + topbar + mobile tabbar
import { api, state, errText } from './api.js';
import { t, setLang, lang } from './i18n.js';
import { h, clear, icon, toast, dropdown, timeAgo, vibrate } from './ui.js';
import { openCmdk, closeCmdk, cmdkIsOpen, cmdkKey } from './cmdk.js';
import { renderLogin } from './views/auth.js';
import { renderGate } from './views/gate.js';
import { renderMail } from './views/mail.js';
import { renderAddresses } from './views/addresses.js';
import { renderVault } from './views/vault.js';
import { renderDomains } from './views/domains.js';
import { renderSettings } from './views/settings.js';
import { renderAbout } from './views/about.js';
import { renderHelp } from './views/help.js';
import { renderInto as renderAlerts } from './health.js';

const app = document.getElementById('app');
const sidebar = document.getElementById('sidebar');
const sbScrim = document.getElementById('sb-scrim');
const sbNav = document.getElementById('sb-nav');
const sbLabel = document.getElementById('sb-label');
const sbTag = document.getElementById('sb-tag');
const sbUser = document.getElementById('sb-user');
const topbar = document.getElementById('topbar');
const tbMenu = document.getElementById('tb-menu');
const tbTitle = document.getElementById('tb-title');
const tbEnd = document.getElementById('tb-end');
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

const viewMeta = {
  mail: { icon: 'inbox', title: () => t('navMail'), eyebrow: () => t('eyebrowMail') },
  addresses: { icon: 'mail', title: () => t('navAddresses'), eyebrow: () => t('eyebrowAddresses') },
  vault: { icon: 'key', title: () => t('navVault'), eyebrow: () => t('eyebrowVault') },
  domains: { icon: 'globe', title: () => t('navDomains'), eyebrow: () => t('eyebrowDomains') },
  settings: { icon: 'settings', title: () => t('navSettings'), eyebrow: () => t('eyebrowSettings') },
  about: { icon: 'heart', title: () => t('navAbout'), eyebrow: () => t('eyebrowAbout') },
  help: { icon: 'help', title: () => t('navHelp'), eyebrow: () => t('eyebrowHelp') },
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
    if (!authView && state.user?.role === 'admin') renderAlerts(alertHost);
    else { alertHost.hidden = true; clear(alertHost); }
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

// ---------- shell: sidebar + topbar + tabbar ----------
function navItems() {
  const items = [
    { key: 'mail', icon: 'inbox', label: t('navMail'), href: '#/mail' },
    { key: 'addresses', icon: 'mail', label: t('navAddresses'), href: '#/addresses' },
    { key: 'vault', icon: 'key', label: t('navVault'), href: '#/vault' },
    { key: 'help', icon: 'help', label: t('navHelp'), href: '#/help' },
    { key: 'about', icon: 'heart', label: t('navAbout'), href: '#/about' },
  ];
  if (state.user?.role === 'admin') {
    items.push({ key: 'domains', icon: 'globe', label: t('navDomains'), href: '#/domains', cls: 'nav-item--admin' });
  }
  items.push({ key: 'settings', icon: 'settings', label: t('navSettings'), href: '#/settings' });
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
  [sidebar, topbar, tabbar].forEach((el) => { el.hidden = authView; });
  document.body.classList.toggle('is-auth', authView);
  if (authView) { closeSidebar(); return; }

  // ----- sidebar -----
  sbTag.textContent = t('sbTagline');
  sbLabel.textContent = t('sbSection');
  clear(sbNav);
  for (const it of navItems()) {
    sbNav.append(h('a', {
      class: `nav-item ${it.cls ?? ''} ${page === it.key ? 'is-on' : ''}`,
      href: it.href,
      dataset: { nav: it.key },
    }, icon(it.icon), h('span', {}, it.label), it.key === 'mail' ? h('span', { class: 'badge', id: 'nav-unread', style: { display: state.unread > 0 ? '' : 'none' } }, state.unread > 99 ? '99+' : String(state.unread)) : ''));
  }
  clear(sbUser);
  sbUser.hidden = false;
  sbUser.append(
    h('span', { class: 'avatar' }, (state.user?.username ?? '?').slice(0, 1).toUpperCase()),
    h('span', { class: 'grow' },
      h('span', { class: 'u-name' }, state.user?.display_name || state.user?.username || '—'),
      h('span', { class: 'u-sub' }, state.user?.role === 'admin' ? t('roleAdmin') : t('roleMember'))),
    h('span', { class: 'end icn' }, icon('settings')),
  );
  sbUser.onclick = (e) => {
    if (e.target.closest('.end')) { dropdown(sbUser, userMenu()); return; }
    location.hash = '#/settings';
  };

  // ----- topbar -----
  const meta = viewMeta[page] ?? viewMeta.mail;
  clear(tbTitle);
  tbTitle.append(icon(meta.icon), h('span', {}, meta.title()));

  tbMenu.hidden = false;
  tbMenu.innerHTML = icon('menu').innerHTML;
  tbMenu.onclick = openSidebar;

  clear(tbEnd);
  tbEnd.append(
    h('button', { class: 'spot-pill', title: t('searchMail'), 'aria-label': t('searchMail'), onclick: () => openCmdk() },
      icon('search'), h('span', { class: 't' }, t('searchMail')), h('kbd', { class: 'kbd' }, isMac() ? '⌘K' : 'Ctrl K')),
    h('span', { class: 'topbar__date' }, dateLabel()),
    h('button', { class: 'icon-btn', title: t('theme'), 'aria-label': t('theme'), onclick: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') }, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')),
    h('button', { class: 'icon-btn', title: t('language'), 'aria-label': t('language'), onclick: () => { setLang(lang === 'fa' ? 'en' : 'fa'); route(); } }, icon('globe')),
  );
  const userWrap = h('div', { style: { position: 'relative', display: 'inline-flex' } });
  userWrap.append(h('button', { class: 'avatar', 'aria-label': t('account'), onclick: () => dropdown(userWrap, userMenu()) }, (state.user?.username ?? '?').slice(0, 1).toUpperCase()));
  tbEnd.append(userWrap);

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

function dateLabel() {
  try {
    return new Date().toLocaleDateString(lang === 'fa' ? 'fa-IR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch { return ''; }
}

function isMac() { return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent); }

function openSidebar() {
  sidebar.classList.add('open');
  sbScrim.hidden = false;
  sbScrim.onclick = closeSidebar;
}
function closeSidebar() {
  sidebar.classList.remove('open');
  if (sbScrim) sbScrim.hidden = true;
}

function userMenu() {
  const items = [];
  if (state.user) {
    items.push({ label: `${t('account')} — ${state.user.username}`, icon: 'user', fn: () => nav('/settings') });
    if (state.user.role === 'admin') items.push({ label: t('navDomains'), icon: 'globe', fn: () => nav('/domains') });
    items.push('-');
    if (state.user.role === 'admin') items.push({ label: t('navStatus'), icon: 'spark', fn: () => nav('/status?stay') });
    items.push({ label: t('navAbout'), icon: 'heart', fn: () => nav('/about') });
    items.push({ label: t('logout'), icon: 'logout', fn: async () => { await api.post('/api/auth/logout').catch(() => {}); state.user = null; nav('/login'); } });
  }
  return items;
}

// ---------- theme & accent ----------
export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('cmail_theme', theme);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#141a15' : '#f5f7f2');
  // refresh icons that depend on theme
  if (!topbar.hidden) {
    const btn = tbEnd?.querySelector('.icon-btn');
    if (btn) btn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon').innerHTML;
  }
}

export function setAccent(accent) {
  document.documentElement.dataset.accent = accent;
  localStorage.setItem('cmail_accent', accent);
}

// the ambient stage behind the whole app: aurora (alive) · halo (still) · pure (flat)
export function setBg(mode) {
  document.documentElement.dataset.bg = mode;
  localStorage.setItem('cmail_bg', mode);
}

// ---------- session keepalive (refresh unread badge + new-mail notify) ----------
setInterval(async () => {
  if (!state.user || topbar.hidden) return;
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
  for (const id of ['nav-unread', 'tab-unread']) {
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
  setAccent(localStorage.getItem('cmail_accent') ?? 'sage');
  document.documentElement.dataset.bg = localStorage.getItem('cmail_bg') ?? 'aurora';

  window.addEventListener('cmail:unauthorized', () => {
    state.user = null;
    if (!location.hash.startsWith('#/login')) { toast(t('invalidCredentials'), 'err'); location.hash = '#/login'; }
  });
  window.addEventListener('cmail:rerender', () => { if (!location.hash.includes('/status')) route(); });
  window.addEventListener('hashchange', route);

  // ⌘K / Ctrl+K — command palette · “/” focus mail search
  const kbdHandler = (e) => {
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
