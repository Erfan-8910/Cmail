// Cmail — app shell: boot, router, dynamic island
import { api, state, errText } from './api.js';
import { t, setLang, lang } from './i18n.js';
import { h, clear, icon, toast, dropdown, timeAgo } from './ui.js';
import { renderLogin, renderSetup } from './views/auth.js';
import { renderMail } from './views/mail.js';
import { renderAddresses } from './views/addresses.js';
import { renderVault } from './views/vault.js';
import { renderDomains } from './views/domains.js';
import { renderSettings } from './views/settings.js';
import { renderCreator } from './views/creator.js';
import { renderHelp } from './views/help.js';

const app = document.getElementById('app');
const island = document.getElementById('island');
const islandCenter = document.getElementById('island-center');
const islandActions = document.getElementById('island-actions');

// ---------- routing ----------
const routes = {
  mail: renderMail,
  addresses: renderAddresses,
  vault: renderVault,
  domains: renderDomains,
  settings: renderSettings,
  creator: renderCreator,
  help: renderHelp,
  login: renderLogin,
  setup: renderSetup,
};

export function nav(hash) { location.hash = hash; }

function currentRoute() {
  const raw = (location.hash || '').replace(/^#\//, '').split('?')[0];
  const [page, ...rest] = raw.split('/');
  return { page: page || '', arg: rest.join('/') };
}

async function route() {
  const { page } = currentRoute();

  // guards
  if (!state.setup) {
    try { state.setup = await api.get('/api/setup/status'); }
    catch { toast(t('network'), 'err'); return; }
  }
  if (!state.setup.admin_created && page !== 'setup') { location.hash = '#/setup'; return; }
  if (state.setup.admin_created && page === 'setup' && state.user) { location.hash = '#/mail'; return; }

  const needsAuth = page !== 'login' && page !== 'setup';
  if (needsAuth && !state.user) { location.hash = '#/login'; return; }
  if (page === 'login' && state.user) { location.hash = '#/mail'; return; }

  renderIsland(page);
  clear(app);
  window.scrollTo({ top: 0 });

  if (page === 'login') return renderLogin(app);
  if (page === 'setup') return renderSetup(app);

  const view = routes[page] ?? renderMail;
  try {
    await view(app, currentRoute().arg);
  } catch (e) {
    if (e.code === 'unauthorized') return;
    toast(errText(e), 'err');
    app.append(h('div', { class: 'empty' }, h('div', { class: 'empty__t' }, t('error')), h('div', { class: 'empty__d' }, e.message ?? '')));
  }
}

// ---------- dynamic island ----------
export function renderIsland(page) {
  if (page === 'login' || page === 'setup') { island.hidden = true; return; }
  island.hidden = false;

  clear(islandCenter);
  clear(islandActions);

  // contextual center: quick nav pills
  const navItems = [
    { key: 'mail', icon: 'inbox', label: t('navMail') },
    { key: 'addresses', icon: 'mail', label: t('navAddresses') },
    { key: 'vault', icon: 'key', label: t('navVault') },
    { key: 'help', icon: 'help', label: t('navHelp') },
  ];
  for (const it of navItems) {
    islandCenter.append(h('a', {
      class: `chip ${page === it.key ? 'is-on' : ''}`,
      href: `#/${it.key}`,
      dataset: { nav: it.key },
      style: { textDecoration: 'none' },
    }, icon(it.icon), h('span', { class: 'hide-sm' }, it.label)));
  }

  // actions: theme, lang, user
  const themeBtn = h('button', {
    class: 'icon-btn', title: t('theme'), 'aria-label': t('theme'),
    onclick: () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      setTheme(next);
    },
  }, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'));
  islandActions.append(themeBtn);

  const langBtn = h('button', {
    class: 'icon-btn', title: t('language'), 'aria-label': t('language'),
    onclick: () => { setLang(lang === 'fa' ? 'en' : 'fa'); route(); },
  }, icon('globe'));
  islandActions.append(langBtn);

  const userWrap = h('div', { style: { position: 'relative', display: 'inline-flex' } });
  const ava = h('button', { class: 'avatar', 'aria-label': t('account'), onclick: () => dropdown(userWrap, userMenu) }, (state.user?.username ?? '?').slice(0, 1).toUpperCase());
  userWrap.append(ava);
  islandActions.append(userWrap);
}

function userMenu() {
  const items = [];
  if (state.user) {
    items.push({ label: `${t('account')} — ${state.user.username}`, icon: 'user', fn: () => nav('/settings') });
    if (state.user.role === 'admin') {
      items.push({ label: t('navAdmin'), icon: 'settings', fn: () => nav('/settings') });
      items.push({ label: t('navDomains'), icon: 'globe', fn: () => nav('/domains') });
    }
    items.push('-');
    items.push({ label: t('navCreator'), icon: 'heart', fn: () => nav('/creator') });
    items.push({ label: t('logout'), icon: 'logout', fn: async () => { await api.post('/api/auth/logout').catch(() => {}); state.user = null; nav('/login'); } });
  }
  return items;
}

// ---------- theme ----------
export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('cmail_theme', theme);
  const logo = document.getElementById('island-logo');
  if (logo) logo.src = theme === 'dark' ? 'assets/img/icon-white.png' : 'assets/img/icon-black.png';
}

// ---------- session keepalive loop (refresh unread badge) ----------
setInterval(async () => {
  if (!state.user || island.hidden) return;
  try {
    const r = await api.get('/api/auth/me');
    state.user = r.user;
    if (r.unread !== state.unread) {
      state.unread = r.unread;
      updateUnreadBadge();
    }
  } catch { /* silent */ }
}, 20_000);

export function updateUnreadBadge() {
  const btn = document.querySelector('[data-nav="mail"]');
  if (!btn) return;
  let badge = btn.querySelector('.badge');
  if (state.unread > 0) {
    if (!badge) badge = h('span', { class: 'badge' });
    badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
    btn.append(badge);
  } else badge?.remove();
}

// ---------- boot ----------
(async function boot() {
  setTheme(localStorage.getItem('cmail_theme') ?? 'dark');

  window.addEventListener('cmail:unauthorized', () => {
    state.user = null;
    if (!location.hash.startsWith('#/login')) { toast(t('invalidCredentials'), 'err'); location.hash = '#/login'; }
  });
  window.addEventListener('hashchange', route);

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
