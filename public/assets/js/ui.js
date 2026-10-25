// Cmail — UI helpers: dom builder, icons, toasts, modals, menus, copy
import { t } from './i18n.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'circle', 'rect', 'path', 'line', 'text', 'g', 'defs', 'ellipse', 'polygon', 'polyline']);

export function h(tag, attrs = {}, ...children) {
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') { if (SVG_TAGS.has(tag)) el.setAttribute('class', String(v)); else el.className = v; }
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(9)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

// ---------- icons (inline svg, stroke style) ----------
const I = (paths, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</svg>`;

export const icons = {
  mail: I('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="m3.5 7 8.5 6.5L20.5 7"/>'),
  inbox: I('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/>'),
  send: I('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>'),
  star: I('<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21l1.2-6.9-5-4.9 6.9-1z"/>'),
  trash: I('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  plus: I('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  shield: I('<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/><path d="m9 11.5 2 2 4-4.5"/>'),
  key: I('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 9-9"/><path d="m17 4 3 3"/><path d="m14 7 3 3"/>'),
  settings: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/>'),
  globe: I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>'),
  user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>'),
  note: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  copy: I('<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  refresh: I('<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>'),
  check: I('<path d="m4 12.5 5 5L20 6.5"/>'),
  x: I('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  chevron: I('<path d="m6 9 6 6 6-6"/>'),
  menu: I('<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>'),
  logout: I('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
  sun: I('<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>'),
  moon: I('<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>'),
  external: I('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  download: I('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'),
  paperclip: I('<path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
  eye: I('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
  help: I('<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
  edit: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  zap: I('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>'),
  qr: I('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v.01M14 21v.01M18 18h3v3"/>'),
  globeAm: I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>'),
  heart: I('<path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6.3a5 5 0 1 1 7.5 6.3z"/>'),
  code: I('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'),
  arrow: I('<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>'),
  archive: I('<rect x="2" y="4" width="20" height="5" rx="1.5"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>'),
  info: I('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M12 12v5"/>'),
  alarm: I('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M5 3 2 6"/><path d="m19 3 3 3"/>'),
  leaf: I('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>'),
  columns: I('<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M12 3v18"/>'),
  database: I('<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5V12c0 1.66 3.58 3 8 3s8-1.34 8-3V5.5"/><path d="M4 12v6.5c0 1.66 3.58 3 8 3s8-1.34 8-3V12"/>'),
  spark: I('<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3.2"/>'),
  lock: I('<rect x="4.5" y="10.5" width="15" height="10" rx="3"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>'),
  palette2: I('<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="13.5" r="1.2" fill="currentColor" stroke="none"/>'),
};

export function icon(name, cls = '') {
  const span = h('span', { class: `icn ${cls}`, 'aria-hidden': 'true' });
  span.innerHTML = icons[name] ?? icons.info;
  span.style.display = 'inline-flex';
  return span;
}

// ---------- haptic feedback (mobile, silent no-op elsewhere) ----------
export function vibrate(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
}

// ---------- toast ----------
export function toast(msg, kind = 'info', ms = 2600) {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast toast--${kind}`, role: 'status' }, icon(kind === 'ok' ? 'check' : kind === 'err' ? 'x' : 'info'), h('span', {}, msg));
  box.append(el);
  vibrate(kind === 'err' ? [14, 60, 14] : 8);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 320); }, ms);
}

// ---------- modal (bottom-sheet on touch devices) ----------
export function modal({ title, iconName, body, footer, wide, onClose }) {
  const root = document.getElementById('modals');
  const back = h('div', { class: 'modal-back' });
  const sheet = window.matchMedia?.('(max-width: 860px)').matches;
  const m = h('div', { class: `modal ${wide ? 'modal--wide' : ''} ${sheet ? 'modal--sheet' : ''}`, role: 'dialog', 'aria-modal': 'true' });
  if (sheet) m.append(h('span', { class: 'modal__grab', 'aria-hidden': 'true' }));
  const close = () => { back.remove(); onClose?.(); };
  vibrate(5);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', function esc2(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); } });

  if (title) m.append(h('div', { class: 'modal__head' }, h('h3', { class: 'modal__title' }, iconName ? icon(iconName) : '', title),
    h('button', { class: 'icon-btn', onclick: close }, icon('x'))));
  const bd = h('div', { class: 'modal__body' });
  if (body) bd.append(...(Array.isArray(body) ? body : [body]));
  m.append(bd);
  if (footer) m.append(h('div', { class: 'modal__foot' }, ...(Array.isArray(footer) ? footer : [footer])));
  back.append(m);
  root.append(back);
  return { close, el: m, body: bd };
}

export function confirmBox(text, onYes, danger = true) {
  const m = modal({
    title: text, iconName: 'info',
    footer: [
      h('button', { class: 'btn', onclick: () => m.close() }, t('cancel')),
      h('button', { class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, onclick: () => { m.close(); onYes(); } }, t('yes')),
    ],
  });
}

// ---------- dropdown menu ----------
export function dropdown(anchor, items) {
  vibrate(5);
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const menu = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it === '-') { menu.append(h('div', { class: 'menu__sep' })); continue; }
    menu.append(h('a', { class: 'menu__item', href: it.href ?? '#', onclick: (e) => { if (it.fn) { e.preventDefault(); it.fn(); } menu.remove(); e.stopPropagation(); } },
      it.icon ? icon(it.icon) : '', it.label, it.badge ? h('span', { class: 'addr-item__badge', style: { marginLeft: 'auto' } }, it.badge) : ''));
  }
  const wrap = h('div', { style: { position: 'relative' } }, menu);
  anchor.append(wrap);
  const off = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', off); } };
  setTimeout(() => document.addEventListener('click', off), 0);
  return menu;
}

// ---------- clipboard ----------
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text; document.body.append(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
}

// ---------- time formatting ----------
export function timeAgo(ts, t) {
  const d = Date.now() - ts;
  if (d < 60_000) return t('justNow');
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} ${t('minutesAgo')}`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} ${t('hoursAgo')}`;
  return `${Math.floor(d / 86_400_000)} ${t('daysAgo')}`;
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleString(document.documentElement.lang === 'fa' ? 'fa-IR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(3, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function fmtCountdown(ms, t) {
  if (ms <= 0) return t('expired');
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function avatarColor(str) {
  const palette = ['#8fae7e', '#7ea3b1', '#a08cb5', '#c9a86a', '#c2848a', '#7fae9a', '#a38f6f', '#8b9e78'];
  let x = 0;
  for (const ch of String(str ?? '?')) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[x % palette.length];
}
