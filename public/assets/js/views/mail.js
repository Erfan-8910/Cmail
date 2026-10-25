// Cmail — mail view: account-style inboxes / list / viewer + notes + compose
// Each mailbox behaves like its own account: its mail, its notes, its 2FA codes.
// HTML emails are sanitized and rendered in a height-adaptive sandboxed frame.
import { api, state, errText } from '../api.js';
import { t, lang } from '../i18n.js';
import { h, clear, icon, toast, modal, confirmBox, copyText, timeAgo, esc, avatarColor, fmtBytes, vibrate, glyphTile } from '../ui.js';
import { entryModal } from './vault.js';

let box = 'inbox';
let search = '';
let selected = new Set();
let viewerState = null;
let cursorIdx = -1;      // keyboard cursor over the visible list
let lastFirstId = null;  // for new-mail highlight
let selecting = false;   // touch selection mode
let vaultCache = [];     // per-account 2FA entries (id, code, remaining, ...)

const sendReady = () => state.setup?.sending_ready !== false && !!state.setup?.admin_created;

// global cross-module events (command palette → mail)
window.addEventListener('cmail:refresh-mail', () => {
  if (!document.getElementById('email-list')) return;
  loadEmails(true);
});
window.addEventListener('cmail:switch-inbox', (e) => {
  if (!document.getElementById('email-list')) return;
  state.currentAddressId = e.detail;
  selected.clear();
  drawSidebar(); drawAcctStrip(); drawList(); loadEmails();
});

export function renderMail(root, arg) {
  box = 'inbox';
  search = '';
  selected.clear();
  cursorIdx = -1;
  lastFirstId = null;
  selecting = false;

  const view = h('div', { class: 'view view--full' });
  const grid = h('div', { class: 'mail' });
  const scrim = h('div', { class: 'mail__scrim', onclick: () => grid.classList.remove('show-sidebar') });

  const sidebar = buildSidebar();
  const listCol = buildList();
  const viewerCol = h('section', { class: 'mail__col glass mail__viewer-col viewer' }, emptyViewer());

  grid.append(sidebar, listCol, viewerCol, scrim);
  view.append(grid);
  // the compose option exists only when a sending provider is actually connected
  if (sendReady()) {
    view.append(h('button', { class: 'compose-fab', title: t('compose'), 'aria-label': t('compose'), onclick: () => openCompose() }, icon('send')));
  }
  root.append(view);

  loadAddresses().then(() => {
    if (arg) openEmail(arg);
  });
}

function emptyViewer() {
  return h('div', { class: 'empty' }, icon('mail'), h('div', { class: 'empty__t' }, t('selectEmail')), h('div', { class: 'empty__d' }, t('selectEmailSub')));
}

// ---------- sidebar: mailbox accounts ----------
async function loadAddresses() {
  try {
    const r = await api.get('/api/addresses');
    state.addresses = r.addresses ?? [];
    if (!state.currentAddressId || !state.addresses.find((a) => a.id === state.currentAddressId)) {
      state.currentAddressId = state.addresses[0]?.id ?? null;
    }
    drawSidebar();
    drawAcctStrip();
    drawList();
    if (state.currentAddressId) loadEmails();
  } catch (e) { toast(errText(e), 'err'); }
}

let sidebarScroll = null;
function buildSidebar() {
  const head = h('div', { class: 'mail__head' },
    h('h3', {}, icon('user'), t('navAddresses')),
    h('div', { class: 'row', style: { gap: '2px' } },
      h('button', { class: 'icon-btn', title: t('newAlias'), onclick: () => createAddressModal(() => { loadAddresses(); }) }, icon('plus')),
    ));
  sidebarScroll = h('div', { class: 'mail__scroll', id: 'addr-list' });
  const aside = h('aside', { class: 'mail__col glass mail__sidebar' }, head, sidebarScroll);
  return aside;
}

function drawSidebar() {
  const box2 = clear(document.getElementById('addr-list') ?? sidebarScroll);
  for (const a of state.addresses) {
    const color = a.kind === 'temp' ? 'var(--warn)' : 'var(--acc)';
    const item = h('div', {
      class: `addr-item ${a.id === state.currentAddressId ? 'is-on' : ''}`,
      onclick: () => {
        state.currentAddressId = a.id;
        selected.clear(); selecting = false;
        drawSidebar(); drawAcctStrip(); drawList(); loadEmails();
        document.querySelector('.mail')?.classList.remove('show-sidebar');
      },
    },
      h('span', { class: 'addr-item__dot', style: { background: color, opacity: a.id === state.currentAddressId ? 1 : .45 } }),
      h('span', { class: 'email-row__ava addr-item__ava', style: { background: avatarColor(a.address) } }, (a.label || a.address).slice(0, 1).toUpperCase()),
      h('span', { class: 'addr-item__body' },
        h('span', { class: 'addr-item__addr' }, a.address),
        h('span', { class: 'addr-item__meta' },
          h('span', { class: `kind-tag kind-tag--${a.kind === 'temp' ? 'temp' : 'perm'}` }, a.kind === 'temp' ? t('temporary') : t('permanent')),
          a.label ? h('span', {}, a.label) : '',
          a.total ? h('span', { class: 'faint' }, `${a.total} ${t('acctMails')}`) : '')),
      a.unread > 0 ? h('span', { class: 'addr-item__badge' }, a.unread > 9 ? '9+' : String(a.unread)) : '',
      h('button', {
        class: 'icon-btn addr-item__info', title: t('acctProfile'), 'aria-label': t('acctProfile'),
        onclick: (e) => { e.stopPropagation(); accountModal(a); },
      }, icon('edit')));
    box2.append(item);
  }
  // account-switcher row: add another account
  box2.append(h('button', {
    class: 'addr-add',
    onclick: () => createAddressModal(() => { loadAddresses(); }),
  }, h('span', { class: 'addr-add__plus' }, icon('plus')), h('span', {}, t('acctNew'))));
}

// ---------- mailbox account modal: identity + notes + its own 2FA ----------
async function accountModal(a) {
  vibrate(5);
  const color = avatarColor(a.address);

  // fetch entries scoped to this mailbox + live codes
  let entries = [];
  try {
    const r = await api.get(`/api/totp?address_id=${encodeURIComponent(a.id)}`);
    entries = r.entries ?? [];
    vaultCache = entries;
  } catch { /* vault fetch is best-effort here */ }

  const labelIn = h('input', { class: 'input', value: a.label ?? '', placeholder: t('label') });
  const notesIn = h('textarea', { class: 'input acct-notes', rows: 5, placeholder: t('acctNotesPh') });
  notesIn.value = a.notes ?? '';

  let saveT = null;
  const saveAccount = (immediateToast) => {
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      try {
        await api.patch(`/api/addresses/${a.id}`, { label: labelIn.value.trim(), notes: notesIn.value });
        const me = state.addresses.find((x) => x.id === a.id);
        if (me) { me.label = labelIn.value.trim() || null; me.notes = notesIn.value; }
        drawSidebar();
        drawAcctStrip();
        if (immediateToast) toast(t('saved'), 'ok', 1400);
      } catch (e) { toast(errText(e), 'err'); }
    }, immediateToast ? 0 : 550);
  };
  labelIn.addEventListener('input', () => saveAccount(false));
  notesIn.addEventListener('input', () => saveAccount(false));

  const totpWrap = h('div', { class: 'acct-totps' });
  function drawTotp() {
    clear(totpWrap);
    if (!entries.length) {
      totpWrap.append(h('div', { class: 'acct-totps__empty' }, icon('key'), h('span', {}, t('acct2faEmpty'))));
      return;
    }
    for (const e of entries) {
      const codeEl = h('span', { class: 'acct-totp__code mono', html: esc(e.code ?? '——————') });
      totpWrap.append(h('div', { class: 'acct-totp' },
        glyphTile(e.icon, e.color ?? color, (e.issuer || e.name).slice(0, 1)),
        h('span', { class: 'acct-totp__name' }, e.name),
        codeEl,
        h('button', {
          class: 'icon-btn', title: t('deleteEntry'),
          onclick: async (ev) => {
            ev.stopPropagation();
            confirmBox(t('deleteEntryConfirm'), async () => {
              await api.del(`/api/totp/${e.id}`);
              entries = entries.filter((x) => x.id !== e.id);
              drawTotp(); toast(t('deletedN'), 'ok', 1500);
            });
          },
        }, icon('trash'))));
    }
  }
  drawTotp();

  const m = modal({
    title: t('acctProfile'), iconName: 'user', wide: true,
    body: [
      h('div', { class: 'acct-head' },
        h('span', { class: 'email-row__ava', style: { background: color, width: '44px', height: '44px', borderRadius: '14px', fontSize: '18px' } }, (a.label || a.address).slice(0, 1).toUpperCase()),
        h('div', { class: 'grow' },
          h('div', { class: 'acct-head__addr mono', onclick: async () => { await copyText(a.address); toast(t('copied'), 'ok', 1300); } }, a.address, icon('copy')),
          h('div', { class: 'small muted' }, `${a.kind === 'temp' ? t('temporary') : t('permanent')} · ${a.total ?? 0} ${t('acctMails')}`)),
      ),
      h('div', { class: 'field' }, h('label', {}, t('label')), labelIn),
      h('div', { class: 'field' }, h('label', {}, t('acctNotes')), notesIn),
      h('div', { class: 'acct-2fa' },
        h('div', { class: 'acct-2fa__head' }, icon('key'), h('b', {}, t('acct2fa')),
          h('button', {
            class: 'btn btn--sm btn--primary', onclick: async () => {
              m.close();
              await entryModal(null, { addressId: a.id, onDone: async () => { drawSidebar(); } });
            },
          }, icon('plus'), h('span', { class: 'hide-sm' }, t('acct2faAdd')))),
        totpWrap),
    ],
    footer: [
      h('button', { class: 'btn btn--ghost', onclick: () => m.close() }, t('cancel')),
      h('button', { class: 'btn btn--primary', onclick: () => { saveAccount(true); m.close(); } }, t('save')),
    ],
  });
}

// ---------- list ----------
let listScroll = null;
let emails = [];

  // account switcher strip — every mailbox is its own space, picked from the top
  function buildList() {
  const canSend = sendReady();
  const head = h('div', { class: 'mail__head' },
    h('h3', {}, icon('inbox'), t('inbox')),
    h('div', { class: 'row', style: { gap: '4px' } },
      canSend ? h('button', { class: 'btn btn--sm btn--primary', onclick: () => openCompose() }, icon('send'), h('span', { class: 'hide-sm' }, t('compose'))) : '',
      h('button', { class: 'icon-btn', title: t('refresh'), onclick: (e) => { e.currentTarget.querySelector('svg')?.classList.add('spin'); loadEmails(true); setTimeout(() => document.querySelector('.mail .icon-btn svg.spin')?.classList.remove('spin'), 700); } }, icon('refresh')),
      h('button', { class: 'icon-btn', title: t('navAddresses'), onclick: () => document.querySelector('.mail')?.classList.toggle('show-sidebar'), dataset: { mobile: 'menu' } }, icon('menu')),
    ));

  const acctStrip = h('div', { class: 'acct-strip', id: 'acct-strip' });

  const searchInput = h('input', {
    class: 'input mail__search', type: 'search', placeholder: t('search'),
    oninput: (e) => { search = e.target.value.trim(); clearTimeout(searchInput._t); searchInput._t = setTimeout(() => loadEmails(true), 350); },
  });

  const filters = h('div', { class: 'filters' });
  for (const [key, label] of [['inbox', t('allMail')], ['unread', t('unread')], ['starred', t('starred')], ['noted', t('noted')]]) {
    filters.append(h('button', {
      class: `chip ${box === key ? 'is-on' : ''}`,
      onclick: (e) => { box = key; filters.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-on')); e.currentTarget.classList.add('is-on'); loadEmails(true); },
    }, label));
  }

  listScroll = h('div', { class: 'mail__scroll', id: 'email-list' });
  const bulk = h('div', { class: 'filters filters--bulk hidden', id: 'bulk-bar' });

  const sec = h('section', { class: 'mail__col glass mail__list-col' }, head, acctStrip, searchInput, filters, bulk, listScroll);
  return sec;
}

function drawAcctStrip() {
  const strip = document.getElementById('acct-strip');
  if (!strip) return;
  clear(strip);
  for (const a of state.addresses) {
    strip.append(h('button', {
      class: `acct-pill ${a.id === state.currentAddressId ? 'is-on' : ''}`,
      title: a.address,
      onclick: (e) => {
        state.currentAddressId = a.id;
        selected.clear(); selecting = false;
        strip.querySelectorAll('.acct-pill').forEach((p) => p.classList.remove('is-on'));
        e.currentTarget.classList.add('is-on');
        drawSidebar(); drawList(); loadEmails();
        vibrate(5);
      },
    },
      h('span', { class: 'email-row__ava acct-pill__ava', style: { background: avatarColor(a.address) } }, (a.label || a.address).slice(0, 1).toUpperCase()),
      h('span', { class: 'acct-pill__t' }, a.label || a.address),
      a.unread > 0 ? h('span', { class: 'acct-pill__badge' }, a.unread > 9 ? '9+' : String(a.unread)) : ''));
  }
}

function drawBulkBar() {
  const bar = document.getElementById('bulk-bar');
  if (!bar) return;
  if (!selected.size) { bar.classList.add('hidden'); clear(bar); return; }
  bar.classList.remove('hidden');
  clear(bar);
  bar.append(
    h('span', { class: 'chip is-on' }, `${selected.size}`),
    h('button', { class: 'chip', onclick: () => bulkAction('read') }, icon('check'), t('markSelRead')),
    h('button', { class: 'chip chip--danger', onclick: () => confirmBox(t('deleteSelConfirm'), () => bulkAction('delete')) }, icon('trash'), t('deleteSel')),
    h('button', { class: 'chip', onclick: () => { selected.clear(); selecting = false; drawList(); } }, icon('x'), t('clearSel')),
  );
}

async function bulkAction(action) {
  try {
    await api.post('/api/emails/bulk', { ids: [...selected], action });
    toast(action === 'delete' ? t('deletedN') : t('saved'), 'ok', 1600);
    selected.clear();
    selecting = false;
    drawList();
    drawBulkBar();
    // unread badges, per-account counts and the list itself stay honest
    loadAddresses();
  } catch (e) { toast(errText(e), 'err'); }
}

async function loadEmails(silent) {
  if (!silent) listScroll.append(h('div', { class: 'skel', style: { height: '70px', marginBottom: '8px' } }));
  try {
    const params = new URLSearchParams({ limit: '80' });
    if (state.currentAddressId) params.set('address_id', state.currentAddressId);
    if (box !== 'inbox') params.set('box', box);
    if (search) params.set('q', search);
    const r = await api.get(`/api/emails?${params}`);
    const fresh = r.emails ?? [];
    // detect brand-new first message (auto-refresh, not search-driven)
    if (silent && fresh.length && fresh[0].id !== lastFirstId && !search && box === 'inbox') {
      lastFirstId = fresh[0].id;
    }
    emails = fresh;
    if (cursorIdx >= emails.length) cursorIdx = emails.length - 1;
    drawList();
  } catch (e) { toast(errText(e), 'err'); }
}

function drawList() {
  const list = clear(document.getElementById('email-list') ?? listScroll);
  document.querySelector('.mail')?.classList.toggle('is-selecting', selecting || selected.size > 0);
  if (!emails.length) {
    list.append(h('div', { style: { height: '100%', display: 'grid', placeItems: 'center' } },
      h('div', { class: 'empty' }, icon('inbox'), h('div', { class: 'empty__t' }, t('noEmails')), h('div', { class: 'empty__d' }, t('noEmailsSub')))));
    cursorIdx = -1;
    return;
  }
  emails.forEach((em, i) => {
    const row = emailRow(em);
    if (i === cursorIdx) row.classList.add('is-cursor');
    if (lastFirstId && em.id === lastFirstId && i === 0) row.classList.add('is-new');
    list.append(row);
  });
  setTimeout(() => list.querySelector('.email-row.is-new')?.classList.remove('is-new'), 1600);
}

function emailRow(em) {
  const color = avatarColor(em.from_addr);
  const flags = h('div', { class: 'email-row__flags' });
  // starred state already lives in the star slot — no duplicate flag here
  if (em.has_note) flags.append(h('span', { class: 'flag-note' }, icon('note')));
  if (em.size > 200_000) flags.append(h('span', { class: 'flag-clip' }, icon('paperclip')));

  // hover quick actions — replace the time slot on pointer devices
  const qa = h('div', { class: 'email-row__qa' },
    h('button', {
      title: t('star'), 'aria-label': t('star'),
      onclick: async (e) => {
        e.stopPropagation(); vibrate(6);
        const on = !em.starred;
        try { await api.patch(`/api/emails/${em.id}`, { starred: on }); em.starred = on ? 1 : 0; loadEmails(true); } catch (err) { toast(errText(err), 'err'); }
      },
    }, icon('star')),
    h('button', {
      title: t('delete'), 'aria-label': t('delete'),
      onclick: async (e) => {
        e.stopPropagation(); vibrate([10, 40, 10]);
        try { await api.del(`/api/emails/${em.id}`); toast(t('deletedN'), 'ok', 1400); loadEmails(true); } catch (err) { toast(errText(err), 'err'); }
      },
    }, icon('trash')));

  // touch: the star lives beside the time — one tap, never opens the mail
  const starSlot = h('button', {
    class: `email-row__star ${em.starred ? 'is-on' : ''}`, title: t('star'), 'aria-label': t('star'),
    onclick: async (e) => {
      e.stopPropagation(); vibrate(6);
      const on = !em.starred;
      try { await api.patch(`/api/emails/${em.id}`, { starred: on }); em.starred = on ? 1 : 0; e.currentTarget.classList.toggle('is-on', on); loadEmails(true); } catch (err) { toast(errText(err), 'err'); }
    },
  }, icon('star'));

  const row = h('div', {
    class: `email-row ${em.is_read ? '' : 'is-unread'} ${selected.has(em.id) ? 'is-selected' : ''} ${viewerState === em.id ? 'is-active' : ''}`,
    dataset: { id: em.id },
    onclick: () => {
      if (selecting || selected.size) { toggleSelect(em.id); return; }
      viewerState = em.id;
      cursorIdx = emails.findIndex((x) => x.id === em.id);
      document.querySelector('.mail')?.classList.add('show-viewer');
      drawList();
      openEmail(em.id);
    },
  },
    h('span', { class: 'select-box', onclick: (e) => { e.stopPropagation(); toggleSelect(em.id); } }),
    h('span', { class: 'email-row__ava', style: { background: color } }, (em.from_name || em.from_addr || '?').slice(0, 1).toUpperCase()),
    h('span', { class: 'email-row__body' },
      h('span', { class: 'email-row__top' },
        h('span', { class: 'email-row__from' }, em.from_name || em.from_addr),
        h('span', { class: 'email-row__end' }, starSlot, h('span', { class: 'email-row__time' }, timeAgo(em.received_at, t)))),
      h('div', { class: 'email-row__subj' }, em.subject || '(no subject)'),
      h('div', { class: 'email-row__prev' }, em.preview || ''),
      flags.children.length ? flags : ''),
    qa);

  // touch: long-press enters multi-select mode
  let lpT = null;
  let moved = false;
  row.addEventListener('touchstart', () => { moved = false; lpT = setTimeout(() => {
    if (moved || selecting) return;
    selecting = true;
    vibrate(12);
    toggleSelect(em.id);
    toast(t('selHint'), 'ok', 2200);
  }, 480); }, { passive: true });
  row.addEventListener('touchmove', () => { moved = true; clearTimeout(lpT); }, { passive: true });
  row.addEventListener('touchend', () => clearTimeout(lpT), { passive: true });
  row.addEventListener('contextmenu', (e) => { if (selecting || selected.size) e.preventDefault(); });
  return row;
}

function toggleSelect(id) {
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  vibrate(5);
  if (!selected.size) selecting = false;
  drawList();
  drawBulkBar();
}

// ---------- keyboard navigation (j/k/Enter/x/s/Escape) ----------
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('email-list')) return;                 // only in mail view
  if (document.querySelector('.modal-back, .cmdk-back, .menu')) return; // nothing overlaying
  const typing = /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable;
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); moveCursor(1); }
  else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-1); }
  else if (e.key === 'Enter' || e.key === 'o') { openCursor(); }
  else if (e.key.toLowerCase() === 'x') { if (emails[cursorIdx]) { e.preventDefault(); toggleSelect(emails[cursorIdx].id); } }
  else if (e.key.toLowerCase() === 's') {
    if (emails[cursorIdx]) {
      e.preventDefault(); vibrate(6);
      const em = emails[cursorIdx];
      api.patch(`/api/emails/${em.id}`, { starred: !em.starred }).then(() => { em.starred = em.starred ? 0 : 1; loadEmails(true); }).catch(() => {});
    }
  }
  else if (e.key === 'Escape') {
    if (selected.size || selecting) { selected.clear(); selecting = false; drawList(); drawBulkBar(); return; }
    if (document.querySelector('.mail.show-viewer')) {
      document.querySelector('.mail')?.classList.remove('show-viewer');
      viewerState = null; drawList();
    }
  }
});

function moveCursor(dir) {
  if (!emails.length) return;
  cursorIdx = Math.min(emails.length - 1, Math.max(0, cursorIdx + dir));
  drawList();
  document.querySelector('.email-row.is-cursor')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function openCursor() {
  const em = emails[cursorIdx];
  if (!em) return;
  viewerState = em.id;
  document.querySelector('.mail')?.classList.add('show-viewer');
  drawList();
  openEmail(em.id);
}

// ---------- viewer ----------
async function openEmail(id) {
  const col = document.querySelector('.mail__viewer-col');
  if (!col) return;
  clear(col);
  col.append(h('div', { style: { padding: '20px' } }, h('div', { class: 'skel', style: { height: '26px', width: '60%' } }), h('div', { class: 'skel mt-2', style: { height: '200px' } })));

  try {
    const r = await api.get(`/api/emails/${id}`);
    drawViewer(col, r);
    const row = document.querySelector(`.email-row[data-id="${id}"]`);
    if (row) row.classList.remove('is-unread');
    const me = await api.get('/api/auth/me').catch(() => null);
    if (me) { state.unread = me.unread ?? 0; }
  } catch (e) { toast(errText(e), 'err'); clear(col).append(emptyViewer()); }
}

/* ---------- HTML email sanitizing & rendering ---------- */

// strip scripts / event handlers / dangerous urls — keep full visual structure
function sanitizeEmailHtml(raw) {
  const doc = new DOMParser().parseFromString(String(raw ?? ''), 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, link[rel="import"], base, form, input, button, textarea, select').forEach((n) => n.remove());
  for (const el of [...doc.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const val = String(attr.value ?? '');
      if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
      if (['href', 'src', 'srcset', 'xlink:href', 'action', 'formaction', 'background', 'poster'].includes(name)
        && /^\s*(javascript|vbscript|data\s*:\s*text\/html)/i.test(val)) { el.removeAttribute(attr.name); continue; }
      if (name === 'style' && /expression\s*\(|javascript\s*:/i.test(val)) el.removeAttribute(attr.name);
    }
  }
  return doc;
}

function detectDir(doc) {
  const html = doc.documentElement;
  const langAttr = (html.getAttribute('lang') || doc.body?.getAttribute('dir') || html.getAttribute('dir') || '').toLowerCase();
  if (html.getAttribute('dir') === 'rtl' || langAttr.startsWith('fa') || langAttr.startsWith('ar') || langAttr.startsWith('he')) return 'rtl';
  const text = (doc.body?.textContent || '').slice(0, 800);
  const rtlChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  return rtlChars > text.length * 0.25 ? 'rtl' : 'ltr';
}

// the base stylesheet injected into every rendered email
function mailFrameCss(zoom = 1) {
  return `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font: ${Math.round(14.5 * zoom * 10) / 10}px/1.7 -apple-system, 'Segoe UI', 'Vazirmatn', Tahoma, sans-serif;
      color: #20261f; background: transparent;
      padding: 18px 20px 26px;
      word-break: break-word; overflow-wrap: break-word;
      -webkit-text-size-adjust: 100%;
    }
    img, video { max-width: 100% !important; height: auto; border-radius: 6px; }
    table { max-width: 100% !important; border-collapse: collapse; }
    td, th { word-break: break-word; }
    a { color: #4a7a5a; }
    hr { border: 0; border-top: 1px solid #e4e8e0; margin: 18px 0; }
    blockquote { margin: 12px 0; padding: 4px 14px; border-inline-start: 3px solid #cdd8c6; color: #5a655a; }
    pre, code { font-family: ui-monospace, monospace; font-size: 12.5px; background: #f4f6f1; border-radius: 6px; }
    pre { padding: 12px 14px; overflow-x: auto; }
    code { padding: 1.5px 6px; }
    h1, h2, h3 { line-height: 1.4; }
    p { margin: 0 0 10px; }
    [data-cmail-removed] { display: none; }
  `;
}

function drawViewer(col, r) {
  const em = r.email;
  clear(col);

  const actions = h('div', { class: 'viewer__actions' });
  if (sendReady()) {
    actions.append(
      h('button', { class: 'btn btn--sm btn--ghost', title: t('reply'), onclick: () => openCompose({ to: em.from_addr, subject: `Re: ${em.subject ?? ''}` }) }, icon('arrow'), h('span', { class: 'hide-sm' }, t('reply'))));
  }
  actions.append(
    h('button', { class: `btn btn--sm btn--ghost ${em.starred ? 'is-on' : ''}`, title: t('star'), onclick: async (e) => {
      const on = !em.starred;
      await api.patch(`/api/emails/${em.id}`, { starred: on });
      em.starred = on ? 1 : 0;
      e.currentTarget.classList.toggle('is-on', on);
      loadEmails(true);
    } }, icon('star'), h('span', { class: 'hide-sm' }, t('star'))),
    h('button', { class: 'btn btn--sm btn--ghost', title: t('delete'), onclick: async () => {
      await api.del(`/api/emails/${em.id}`);
      toast(t('deletedN'), 'ok', 1500);
      viewerState = null;
      clear(col).append(emptyViewer());
      document.querySelector('.mail')?.classList.remove('show-viewer');
      loadEmails(true);
    } }, icon('trash'), h('span', { class: 'hide-sm' }, t('delete'))),
    h('button', { class: 'btn btn--sm btn--ghost', title: t('copy'), onclick: async () => { await copyText(em.from_addr); toast(t('copied'), 'ok', 1400); } }, icon('copy')),
  );

  const meta = h('div', { class: 'viewer__meta' },
    h('span', { class: 'avatar', style: { background: avatarColor(em.from_addr), width: '38px', height: '38px', borderRadius: '12px' } }, (em.from_name || em.from_addr).slice(0, 1).toUpperCase()),
    h('div', { class: 'grow' },
      h('div', { style: { fontWeight: 700, fontSize: '13px' } }, em.from_name ? `${em.from_name} · ${em.from_addr}` : em.from_addr),
      h('div', { class: 'small muted' }, `${t('to')} ${em.to_addr} — ${new Date(em.received_at).toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-GB')}`)),
    actions);

  const head = h('div', { class: 'viewer__head' },
    h('h2', { class: 'viewer__subj' }, em.subject || '(no subject)'),
    meta);

  col.append(head);

  // attachments row (above body, mail-client style)
  if (r.attachments?.length) {
    col.append(h('div', { class: 'attachments' },
      r.attachments.map((a) => a.available
        ? h('a', { class: 'att-chip', href: `/api/emails/attachment/${a.id}`, download: a.filename ?? 'file' }, icon('download'), a.filename ?? 'file', h('span', { class: 'faint small' }, fmtBytes(a.size)))
        : h('span', { class: 'att-chip', title: t('attachmentTooBig'), style: { opacity: .5 } }, icon('paperclip'), a.filename ?? 'file'))));
  }

  // ----- render mode state -----
  let mode = em.html_body ? 'html' : 'text';
  let narrow = false;
  let zoom = 1;                      // html reading zoom (0.8 – 1.5)
  const bodyWrap = h('div', { class: 'viewer__body' });

  const seg = h('div', { class: 'seg' });
  const bHtml = h('button', { type: 'button' }, icon('eye'), t('viewRendered'));
  const bText = h('button', { type: 'button' }, icon('code'), t('viewSource'));
  const bWidth = h('button', { type: 'button', class: 'chip', title: t('viewNarrow') }, icon('columns'), h('span', { class: 'hide-sm' }, t('viewNarrow')));
  seg.append(bHtml, bText);
  const zoomOut = h('button', { type: 'button', class: 'chip zoom-chip', title: t('zoomOut'), 'aria-label': t('zoomOut') }, 'A−');
  const zoomLbl = h('span', { class: 'zoom-lbl small faint mono' }, '100%');
  const zoomIn = h('button', { type: 'button', class: 'chip zoom-chip', title: t('zoomIn'), 'aria-label': t('zoomIn') }, 'A+');
  const zoomRow = h('div', { class: 'zoom-ctl' }, zoomOut, zoomLbl, zoomIn);

  function drawZoom() {
    zoomLbl.textContent = `${Math.round(zoom * 100)}%`;
    zoomOut.disabled = zoom <= 0.8;
    zoomIn.disabled = zoom >= 1.5;
  }
  zoomOut.onclick = () => { zoom = Math.max(0.8, Math.round((zoom - 0.1) * 10) / 10); drawZoom(); drawBody(); };
  zoomIn.onclick = () => { zoom = Math.min(1.5, Math.round((zoom + 0.1) * 10) / 10); drawZoom(); drawBody(); };
  drawZoom();

  function drawSeg() {
    bHtml.classList.toggle('is-on', mode === 'html');
    bText.classList.toggle('is-on', mode === 'text');
    bHtml.style.display = em.html_body ? '' : 'none';
    bWidth.querySelector('span:not(.icn)').textContent = narrow ? t('viewWide') : t('viewNarrow');
    bWidth.style.display = mode === 'html' ? '' : 'none';
  }
  bHtml.onclick = () => { mode = 'html'; drawSeg(); drawBody(); };
  bText.onclick = () => { mode = 'text'; drawSeg(); drawBody(); };
  bWidth.onclick = () => { narrow = !narrow; drawBody(); };
  drawSeg();

  col.append(h('div', { class: 'mtools' }, seg, bWidth, zoomRow));

  let frame = null;
  function buildFrame() {
    const doc = sanitizeEmailHtml(em.html_body);
    const dir = detectDir(doc);
    const f = h('iframe', {
      class: `mail-frame ${narrow ? 'mail-frame--narrow' : ''}`,
      sandbox: 'allow-same-origin allow-popups allow-popups-to-escape-sandbox',
      referrerpolicy: 'no-referrer',
      title: em.subject || 'email',
    });
    f.setAttribute('srcdoc',
      `<!doctype html><html dir="${dir}" lang="${doc.documentElement.getAttribute('lang') || 'en'}"><head>` +
      `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank">` +
      `<style>${mailFrameCss(zoom)}</style>${doc.head.innerHTML}</head>` +
      `<body>${doc.body.innerHTML}</body></html>`);
    f.addEventListener('load', () => {
      try {
        const d = f.contentDocument;
        if (!d) return;
        const hh = Math.max(d.documentElement?.scrollHeight ?? 0, d.body?.scrollHeight ?? 0);
        if (hh > 120) f.style.height = `${hh + 20}px`;
        else f.style.height = '100%';
      } catch { f.style.height = '100%'; }
    });
    return f;
  }

  function drawBody() {
    clear(bodyWrap);
    if (mode === 'html' && em.html_body) {
      frame = buildFrame();
      bodyWrap.append(h('div', { class: 'mail-frame-wrap' }, frame));
    } else {
      frame = null;
      bodyWrap.append(h('div', { class: 'mail-frame-wrap' },
        h('div', { class: 'viewer__plain', style: { flex: '1', fontSize: `${Math.round(14.5 * zoom * 10) / 10}px` } }, em.text_body || em.preview || '—')));
    }
  }
  drawBody();

  col.append(bodyWrap);

  // note panel — collapsible everywhere; open by default only when a note exists
  const noteBody = h('textarea', { class: 'input', rows: 3, placeholder: t('notePlaceholder') });
  if (r.note) noteBody.value = r.note.body;
  let noteColor = r.note?.color ?? 'amber';
  const colorRow = h('div', { class: 'note-colors' });
  for (const c of ['amber', 'mint', 'sky', 'rose', 'violet']) {
    colorRow.append(h('button', {
      class: `note-dot note-dot--${c} ${noteColor === c ? 'is-on' : ''}`,
      onclick: (e) => { noteColor = c; colorRow.querySelectorAll('.note-dot').forEach((d) => d.classList.remove('is-on')); e.currentTarget.classList.add('is-on'); saveNote(); },
    }));
  }
  let saveT = null;
  function saveNote() {
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      try {
        await api.put(`/api/emails/${em.id}/note`, { body: noteBody.value, color: noteColor });
        loadEmails(true);
      } catch (e) { toast(errText(e), 'err'); }
    }, 600);
  }
  noteBody.addEventListener('input', saveNote);

  const notePanel = h('div', { class: `note-panel ${r.note?.body ? 'has-note is-open' : ''}` });
  notePanel.append(
    h('button', { class: 'note-panel__head', onclick: () => notePanel.classList.toggle('is-open') },
      icon('note'), h('span', {}, t('noteTitle')),
      noteBody.value ? h('span', { class: 'note-panel__dot' }, '') : '',
      h('span', { class: 'note-panel__chev icn' }, icon('chevron'))),
    h('div', { class: 'note-panel__in' }, noteBody, colorRow));
  col.append(notePanel);

  // mobile back
  col.append(h('button', { class: 'btn btn--sm btn--ghost viewer-back', style: { margin: '8px 14px 12px', alignSelf: 'flex-start' }, onclick: () => { document.querySelector('.mail')?.classList.remove('show-viewer'); viewerState = null; } }, icon('arrow'), h('span', {}, t('navMail'))));
}

// ---------- compose ----------
export async function openCompose(prefill = {}) {
  if (!state.addresses.length) await api.get('/api/addresses').then((r) => state.addresses = r.addresses ?? []).catch(() => {});
  const fromSel = h('select', { class: 'input' },
    state.addresses.map((a) => h('option', { value: a.id, selected: a.id === state.currentAddressId || undefined }, a.address)));
  const to = h('input', { class: 'input ltr', placeholder: 'name@example.com', value: prefill.to ?? '' });
  const subj = h('input', { class: 'input', value: prefill.subject ?? '' });
  const body = h('textarea', { class: 'input', rows: 9, placeholder: t('body') });
  const btn = h('button', { class: 'btn btn--primary', type: 'submit' }, icon('send'), t('send'));

  const m = modal({
    title: t('composeTitle'), iconName: 'send',
    body: [
      h('div', { class: 'field' }, h('label', {}, t('from')), fromSel),
      h('div', { class: 'field' }, h('label', {}, t('to_')), to),
      h('div', { class: 'field' }, h('label', {}, t('subject')), subj),
      h('div', { class: 'field' }, h('label', {}, t('body')), body),
    ],
    footer: [
      h('button', { class: 'btn btn--ghost', onclick: () => m.close() }, t('cancel')),
      btn,
    ],
  });

  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = t('sending');
    try {
      await api.post('/api/emails/send', {
        from_address_id: fromSel.value, to: to.value.trim(), subject: subj.value, text: body.value,
      });
      toast(t('sent'), 'ok');
      m.close();
    } catch (e) { toast(errText(e), 'err'); btn.disabled = false; }
  });
  setTimeout(() => to.focus(), 80);
}

// ---------- random local part ----------
function randLocal() {
  const words = ['swift', 'quiet', 'amber', 'noble', 'velvet', 'orbit', 'lunar', 'cobalt', 'ember', 'onyx', 'delta', 'echo', 'atlas', 'raven', 'frost', 'sable'];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = Math.random().toString(36).slice(2, 8);
  return `${w}.${n}`;
}

// ---------- create inbox modal (shared with addresses view) ----------
export async function createAddressModal(onDone) {
  try {
    if (!state.domains.length) {
      const r = await api.get('/api/addresses/domains');
      state.domains = r.domains ?? [];
    }
  } catch (e) { toast(errText(e), 'err'); return; }
  if (!state.domains.length) {
    toast(t('invalidDomain'), 'err');
    return;
  }

  let kind = 'temp';
  const kindRow = h('div', { class: 'row', style: { gap: '8px' } });
  const domainSel = h('select', { class: 'input' }, state.domains.map((d) => h('option', { value: d.name }, d.name)));
  const local = h('input', { class: 'input ltr', placeholder: 'name' });
  const labelIn = h('input', { class: 'input', placeholder: t('label') });
  const ttlSel = h('select', { class: 'input' },
    [['1', t('hour1')], ['6', t('hours6')], ['24', t('hours24')], ['72', t('days3')], ['168', t('days7')], ['720', t('days30')]]
      .map(([v, l]) => h('option', { value: v, selected: v === '24' || undefined }, l)));
  const ttlField = h('div', { class: 'field' }, h('label', {}, t('ttl')), ttlSel);

  function drawKind() {
    clear(kindRow);
    for (const [k, lab] of [['temp', t('temporary')], ['permanent', t('permanent')]]) {
      kindRow.append(h('button', {
        class: `chip ${kind === k ? 'is-on' : ''}`,
        onclick: () => { kind = k; drawKind(); ttlField.style.display = kind === 'temp' ? '' : 'none'; },
      }, icon(k === 'temp' ? 'clock' : 'mail'), lab));
    }
  }
  drawKind();

  const btn = h('button', { class: 'btn btn--primary', type: 'submit' }, icon('plus'), t('createAddress'));
  const m = modal({
    title: t('createAddress'), iconName: 'mail',
    body: [
      h('div', { class: 'field' }, h('label', {}, t('addrKind')), kindRow),
      h('div', { class: 'field' }, h('label', {}, t('domain')), domainSel),
      h('div', { class: 'field' },
        h('label', {}, t('localPart')),
        h('div', { class: 'row' },
          local,
          h('button', { class: 'btn btn--sm', title: t('random'), onclick: () => { local.value = randLocal(); } }, icon('refresh')))),
      ttlField,
      h('div', { class: 'field' }, h('label', {}, t('label')), labelIn),
    ],
    footer: [h('button', { class: 'btn btn--ghost', onclick: () => m.close() }, t('cancel')), btn],
  });

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const r = await api.post('/api/addresses', {
        local: local.value.trim() || '__random__',
        domain: domainSel.value,
        kind,
        ttl_hours: parseInt(ttlSel.value, 10),
        label: labelIn.value.trim(),
      });
      state.currentAddressId = r.address.id;
      toast(t('saved'), 'ok', 1400);
      m.close();
      onDone?.();
    } catch (e) { toast(errText(e), 'err'); btn.disabled = false; }
  });
}
