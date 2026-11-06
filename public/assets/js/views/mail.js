// Cmail — mail view: account-style inboxes / list / dedicated email page
// Each mailbox behaves like its own account: its mail, its notes, its 2FA codes.
// Opening an email navigates to its own page (#/mail/m/:id) — never a popup.
// HTML emails are sanitized and rendered in a height-adaptive sandboxed frame.
import { api, state, errText } from '../api.js';
import { t, lang } from '../i18n.js';
import { h, clear, icon, toast, modal, confirmBox, copyText, timeAgo, esc, avatarColor, fmtBytes, fmtCountdown, vibrate, glyphTile, lockBadge } from '../ui.js';
import { entryModal, tempGuard, tempAuthorized, grantTempAuth } from './vault.js';

let box = 'inbox';
let search = '';
let selected = new Set();
let cursorIdx = -1;      // keyboard cursor over the visible list
let lastFirstId = null;  // newest known message (auto-refresh)
let newFlashId = null;   // id to highlight when it just arrived
let selecting = false;   // touch selection mode
let autoT = null;        // inbox auto-refresh timer

let emails = [];
let listScroll = null;
let sidebarScroll = null;
let idPlate = null;
let bulkBarEl = null;
let listSeq = 0;         // racing list loads — newest wins

const sendReady = () => state.setup?.sending_ready !== false && !!state.setup?.admin_created;

// global cross-module events (command palette → mail)
window.addEventListener('cmail:refresh-mail', () => {
  if (!listScroll?.isConnected) return;
  loadEmails(true);
});

export async function renderMail(root, arg) {
  // a specific email has its own page — route level, like the big clients
  if (arg && arg.startsWith('m/')) return renderReader(root, arg.slice(2));

  box = 'inbox';
  search = '';
  selected.clear();
  cursorIdx = -1;
  lastFirstId = null;
  newFlashId = null;
  selecting = false;

  const view = h('div', { class: 'view view--full' });
  const grid = h('div', { class: 'mail' });
  const scrim = h('div', { class: 'mail__scrim', onclick: () => grid.classList.remove('show-sidebar') });

  const sidebar = buildSidebar();
  const listCol = buildList();
  const viewerCol = h('section', { class: 'mail__col glass mail__viewer-col viewer' }, emptyViewer());

  grid.append(sidebar, listCol, viewerCol, scrim);
  view.append(grid);
  root.append(view);

  // the compose option is always on stage: a frozen lock rides beside the
  // paper plane while no sending provider is connected, and it opens into
  // the real composer the moment sending is configured (or just refuses
  // politely, explaining what is missing)
  const fab = h('button', { class: `compose-fab ${sendReady() ? '' : 'is-locked'}`, title: sendReady() ? t('compose') : t('sendLockedTitle'), 'aria-label': sendReady() ? t('compose') : t('sendLockedTitle'), onclick: () => sendReady() ? openCompose() : toast(t('sendLockedToast'), 'err') }, icon('send'));
  if (!sendReady()) fab.append(lockBadge('frozen', t('sendLockedTitle')));
  view.append(fab);

  await loadAddresses();

  // auto-refresh: every 10 seconds the inbox pulls
  // the list and the unread badges, highlights whatever just landed, and
  // stays out of the way while an overlay is open
  clearInterval(autoT);
  autoT = setInterval(async () => {
    // the timer only serves THIS render's list — a stale timer from a
    // previous render must never feed the fresh view (rapid-click safety)
    if (!listScroll?.isConnected) { clearInterval(autoT); return; }
    if (document.hidden || document.querySelector('.modal-back, .cmdk-back')) return;
    loadEmails(true);
    loadAddresses(true);
  }, 10_000);
}

function emptyViewer() {
  return h('div', { class: 'empty' }, icon('mail'), h('div', { class: 'empty__t' }, t('selectEmail')), h('div', { class: 'empty__d' }, t('selectEmailSub')));
}

// ---------- the current account ----------
let addrSig = '';  // last painted sidebar signature — skip repaints when nothing changed
async function loadAddresses(quiet = false) {
  try {
    const r = await api.get('/api/addresses');
    state.addresses = r.addresses ?? [];
  } catch (e) { if (!quiet) toast(errText(e), 'err'); state.addresses = state.addresses ?? []; }

  // every mailbox is its own space — the active one survives reloads
  const saved = localStorage.getItem('cmail_acct');
  const savedOk = saved && state.addresses.find((a) => a.id === saved);
  if (savedOk) state.currentAddressId = saved;
  else {
    state.currentAddressId = state.addresses[0]?.id ?? null;
    localStorage.setItem('cmail_acct', state.currentAddressId ?? '');
  }

  // repaint the rails only when something actually changed — the auto-refresh
  // must never yank an open dropdown, a focused row or the scroll position
  // out from under the user
  const sig = JSON.stringify([
    state.addresses.map((a) => [a.id, a.kind, a.label, a.unread, a.total, a.expires_at, tempAuthorized(a.id)]),
    state.currentAddressId,
    emails.length,
  ]);
  if (quiet && sig === addrSig) return;
  addrSig = sig;

  drawSidebar();
  syncAvatarLetter();
  drawListHead();
  drawList();
  if (!quiet) loadEmails();
}

// the shell avatar mirrors the live account
function syncAvatarLetter() {
  const av = document.getElementById('acct-avatar');
  if (!av) return;
  const a = (state.addresses ?? []).find((x) => x.id === state.currentAddressId);
  av.textContent = (a ? (a.label || a.address) : (state.user?.username ?? '?')).slice(0, 1).toUpperCase();
}

const activeAccount = () => (state.addresses ?? []).find((x) => x.id === state.currentAddressId) ?? null;

// switching spaces — one function every entry point funnels through
// (the only switcher in the whole app is the avatar circle in the top bar)
function switchInbox(id, opts = {}) {
  state.currentAddressId = id;
  localStorage.setItem('cmail_acct', id ?? '');
  box = 'inbox'; search = '';
  selected.clear(); selecting = false;
  cursorIdx = -1; lastFirstId = null; newFlashId = null;
  const si = document.querySelector('.mail__search');
  if (si) si.value = '';
  drawSidebar(); drawList(); loadEmails();
  // the list column announces the active space
  drawListHead();
  syncAvatarLetter();
  if (!opts.keepClosed) document.querySelector('.mail')?.classList.remove('show-sidebar');
  vibrate(5);
}

// ---------- sidebar: the account itself + its folders ----------
// no account list here anymore — accounts are switched exclusively from the
// avatar circle in the top bar, exactly like the big clients. the rail under
// the identity card is the account's own folders.
function buildSidebar() {
  const head = h('div', { class: 'mail__head' },
    h('h3', {}, icon('user'), t('navMail')));
  sidebarScroll = h('div', { class: 'mail__scroll', id: 'addr-list' });
  const aside = h('aside', { class: 'mail__col glass mail__sidebar' }, head, sidebarScroll);
  return aside;
}

function drawSidebar() {
  // only ever paint into THIS render's sidebar — a stale async continuation
  // must not reach into the live DOM of a newer render (rapid-click safety)
  if (!sidebarScroll?.isConnected) return;
  const box2 = clear(sidebarScroll);
  const a = activeAccount();

  // ----- identity card: the account this space belongs to -----
  if (!a) {
    box2.append(h('div', { class: 'acct-id glass' },
      h('div', { class: 'empty', style: { padding: '18px 8px' } },
        icon('mail'),
        h('div', { class: 'empty__t' }, t('noAccountsYet')),
        h('div', { class: 'empty__d' }, t('noAccountsSub')),)));
    return;
  }
  const locked = a.kind === 'temp' && !tempAuthorized(a.id);
  const left = a.kind === 'temp' && a.expires_at ? a.expires_at - Date.now() : null;
  const idcard = h('div', { class: 'acct-id glass' },
    h('div', { class: 'acct-id__row' },
      h('span', { class: 'email-row__ava', style: { background: avatarColor(a.address), width: '40px', height: '40px', borderRadius: '13px', fontSize: '16px' } }, (a.label || a.address).slice(0, 1).toUpperCase()),
      h('div', { class: 'acct-id__body' },
        h('div', { class: 'acct-id__addr mono', title: t('copy'), onclick: async () => { await copyText(a.address); toast(t('copied'), 'ok', 1200); } }, a.address),
        h('div', { class: 'acct-id__meta' },
          h('span', { class: `kind-tag kind-tag--${a.kind === 'temp' ? 'temp' : 'perm'}` }, a.kind === 'temp' ? t('temporary') : t('permanent')),
          a.label ? h('span', { class: 'kind-tag kind-tag--label' }, a.label) : '',
          a.kind === 'temp' ? lockBadge(locked ? 'frozen' : 'flame', locked ? t('vaultFrozen') : t('vaultFlame')) : '')),
      h('button', { class: 'icon-btn', title: t('acctProfile'), 'aria-label': t('acctProfile'), onclick: () => accountModal(a) }, icon('settings'))),
    h('div', { class: 'acct-id__stats' },
      h('span', {}, icon('inbox'), h('b', {}, String(a.total ?? 0)), ' ' + t('acctMails')),
      a.unread > 0 ? h('span', { class: 'is-warm' }, icon('mail'), h('b', {}, String(a.unread)), ' ' + t('unread')) : '',
      left !== null ? h('span', { class: left < 3_600_000 ? 'is-warm' : '' }, icon('clock'), h('b', { class: 'mono' }, fmtCountdown(left, t))) : ''));
  box2.append(idcard);

  // ----- folder rail: this account's own boxes -----
  const counts = {
    inbox: emails.length,
    unread: emails.filter((x) => !x.is_read).length,
    starred: emails.filter((x) => x.starred).length,
    noted: emails.filter((x) => x.has_note).length,
  };
  const rail = h('nav', { class: 'mail-folders', role: 'navigation' });
  for (const [key, icn, label] of [
    ['inbox', 'inbox', t('allMail')],
    ['unread', 'mail', t('unread')],
    ['starred', 'star', t('starred')],
    ['noted', 'note', t('noted')],
  ]) {
    rail.append(h('button', {
      class: `mfolder ${box === key ? 'is-on' : ''}`,
      onclick: () => { box = key; drawSidebar(); drawList(); vibrate(5); },
    },
      h('span', { class: 'mfolder__icn' }, icon(icn)),
      h('span', { class: 'mfolder__t' }, label),
      counts[key] > 0 ? h('span', { class: `mfolder__n ${key === 'unread' ? 'mfolder__n--hot' : ''}` }, counts[key] > 99 ? '99+' : String(counts[key])) : ''));
  }
  box2.append(rail);
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
          (() => {
            // temporary mailboxes keep their vault frozen — codes only go in
            // after the owner accepts they die with the address; once granted,
            // the badge flips to the flame and the dialog never asks again
            const b = h('button', { class: 'btn btn--sm btn--primary' });
            const openEntry = () => { m.close(); entryModal(null, { addressId: a.id, onDone: async () => { drawSidebar(); } }); };
            const draw = () => {
              clear(b);
              const locked = a.kind === 'temp' && !tempAuthorized(a.id);
              b.className = `btn btn--sm btn--primary ${locked ? 'is-frozen' : ''}`;
              if (locked) {
                b.append(icon('plus'), lockBadge('frozen', t('vaultFrozen')), h('span', { class: 'hide-sm' }, t('acct2faAdd')));
                b.onclick = () => tempGuard(a, () => { draw(); openEntry(); });
              } else {
                b.append(icon('plus'), a.kind === 'temp' ? lockBadge('flame', t('vaultFlame')) : '', h('span', { class: 'hide-sm' }, t('acct2faAdd')));
                b.onclick = openEntry;
              }
            };
            draw();
            return b;
          })()),
        totpWrap),
    ],
    footer: [
      // the whole account lifecycle lives here now: the sidebar kebab is
      // gone, so purge / delete sit beside save — clear and honest
      h('button', { class: 'btn btn--ghost btn--danger-ghost', title: t('acctPurge'), onclick: () => {
        confirmBox(t('acctPurgeConfirm'), async () => {
          try { await api.post(`/api/addresses/${a.id}/purge`); toast(t('acctPurged'), 'ok'); m.close(); switchInbox(state.currentAddressId, { keepClosed: true }); } catch (e) { toast(errText(e), 'err'); }
        });
      } }, icon('archive'), t('acctPurge')),
      h('button', { class: 'btn btn--ghost btn--danger-ghost', title: t('acctDelete'), onclick: () => {
        confirmBox(t('acctDeleteConfirm'), async () => {
          try {
            await api.del(`/api/addresses/${a.id}`);
            toast(t('deletedN'), 'ok', 1400);
            m.close();
            if (state.currentAddressId === a.id) {
              const rest = state.addresses.filter((x) => x.id !== a.id);
              state.currentAddressId = rest[0]?.id ?? null;
            }
            loadAddresses();
          } catch (e) { toast(errText(e), 'err'); }
        });
      } }, icon('trash'), t('acctDelete')),
      h('span', { style: { flex: '1' } }),
      h('button', { class: 'btn btn--ghost', onclick: () => m.close() }, t('cancel')),
      h('button', { class: 'btn btn--primary', onclick: () => { saveAccount(true); m.close(); } }, t('save')),
    ],
  });
}

// ---------- list ----------
// the compose button in the list header shares the FAB's lock behavior:
// always visible, frozen until a provider is connected
function composeBtn() {
  const ready = sendReady();
  const b = h('button', {
    class: `btn btn--sm btn--primary ${ready ? '' : 'is-locked'}`,
    title: ready ? t('compose') : t('sendLockedTitle'),
    onclick: () => ready ? openCompose() : toast(t('sendLockedToast'), 'err'),
  }, icon('send'), h('span', { class: 'hide-sm' }, t('compose')));
  if (!ready) b.append(lockBadge('frozen', t('sendLockedTitle')));
  return b;
}

function buildList() {
  // the header carries the account itself — as an identity plate, not a
  // switcher: switching lives only in the avatar circle at the top of the
  // page, so nothing inside the inbox ever jumps between accounts
  idPlate = h('div', { class: 'acct-idplate' });
  const head = h('div', { class: 'mail__head' },
    h('div', { class: 'mail__head-id' }, idPlate),
    h('div', { class: 'row', style: { gap: '4px' } },
      composeBtn(),
      h('button', { class: 'icon-btn', title: t('refresh'), onclick: (e) => { e.currentTarget.querySelector('svg')?.classList.add('spin'); loadEmails(true); loadAddresses(true); setTimeout(() => document.querySelector('.mail .icon-btn svg.spin')?.classList.remove('spin'), 700); } }, icon('refresh')),
      h('button', { class: 'icon-btn', title: t('navAddresses'), onclick: () => document.querySelector('.mail')?.classList.toggle('show-sidebar'), dataset: { mobile: 'menu' } }, icon('menu')),
    ));

  const searchInput = h('input', {
    class: 'input mail__search', type: 'search', placeholder: t('search'),
    oninput: (e) => { search = e.target.value.trim(); clearTimeout(searchInput._t); searchInput._t = setTimeout(() => loadEmails(true), 350); },
  });

  listScroll = h('div', { class: 'mail__scroll', id: 'email-list' });
  bulkBarEl = h('div', { class: 'filters filters--bulk hidden' });

  const sec = h('section', { class: 'mail__col glass mail__list-col' }, head, searchInput, bulkBarEl, listScroll);
  return sec;
}

// paint the identity plate in the list header from the live account —
// a quiet statement of whose inbox this is, never a button
function drawListHead() {
  if (!idPlate?.isConnected) return;
  const el = idPlate;
  const a = (state.addresses ?? []).find((x) => x.id === state.currentAddressId);
  clear(el);
  if (!a) { el.append(h('span', { class: 'acct-idplate__name muted' }, t('noAccountsYet'))); return; }
  el.append(
    h('span', { class: 'email-row__ava acct-idplate__ava', style: { background: avatarColor(a.address) } }, (a.label || a.address).slice(0, 1).toUpperCase()),
    h('span', { class: 'acct-idplate__txt' },
      h('span', { class: 'acct-idplate__name' }, a.label || a.address),
      h('span', { class: 'acct-idplate__meta' }, `${a.kind === 'temp' ? t('temporary') : t('permanent')} · ${a.total ?? 0} ${t('acctMails')}`)),
    a.unread > 0 ? h('span', { class: 'acct-idplate__badge' }, a.unread > 9 ? '9+' : String(a.unread)) : '');
}

function drawBulkBar() {
  const bar = bulkBarEl;
  if (!bar?.isConnected) return;
  if (!selected.size) { bar.classList.add('hidden'); clear(bar); return; }
  bar.classList.remove('hidden');
  clear(bar);
  bar.append(
    h('span', { class: 'chip is-on' }, `${selected.size}`),
    // delete leads the bar — the action people pick must be the first one there
    h('button', { class: 'chip chip--danger', onclick: () => confirmBox(t('deleteSelConfirm'), () => bulkAction('delete')) }, icon('trash'), t('deleteSel')),
    h('button', { class: 'chip', onclick: () => {
      const visible = emails.filter((x) => !x.expired);
      const every = visible.length && visible.every((x) => selected.has(x.id));
      visible.forEach((x) => { if (every) selected.delete(x.id); else selected.add(x.id); });
      selecting = selected.size > 0;
      drawList(); drawBulkBar();
    } }, icon('check'), t('selectAll')),
    h('button', { class: 'chip', onclick: () => bulkAction('read') }, icon('check'), t('markSelRead')),
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
  if (!state.currentAddressId) { emails = []; drawList(); drawSidebar(); return; }
  // racing loads (fast clicks, auto-refresh, account switches) — only the
  // newest request may paint the list; older responses bail out silently
  const seq = ++listSeq;
  if (!document.body.contains(listScroll ?? document.body)) return;
  if (!silent) listScroll.append(h('div', { class: 'skel', style: { height: '70px', marginBottom: '8px' } }));
  try {
    // the whole box arrives in one pull — folders (all / unread / starred /
    // noted) are cut client-side, so flipping between them is instant and
    // the sidebar counters are always exact
    const params = new URLSearchParams({ limit: '80' });
    params.set('address_id', state.currentAddressId);
    if (search) params.set('q', search);
    const r = await api.get(`/api/emails?${params}`);
    if (seq !== listSeq || !document.body.contains(listScroll ?? document.body)) return;
    const fresh = r.emails ?? [];
    // auto-refresh detection: the newest id changed without any user action
    if (silent && fresh.length && !search) {
      if (lastFirstId && fresh[0].id !== lastFirstId) newFlashId = fresh[0].id;
      lastFirstId = fresh[0].id;
    }
    emails = fresh;
    if (cursorIdx >= visibleEmails().length) cursorIdx = visibleEmails().length - 1;
    drawList();
    drawSidebar();
  } catch (e) { if (seq === listSeq) toast(errText(e), 'err'); }
}

// the visible cut of the folder the user is in
function visibleEmails() {
  if (box === 'unread') return emails.filter((x) => !x.is_read);
  if (box === 'starred') return emails.filter((x) => x.starred);
  if (box === 'noted') return emails.filter((x) => x.has_note);
  return emails;
}

function drawList() {
  if (!listScroll?.isConnected) return;   // stale render — touch nothing
  const list = clear(listScroll);
  document.querySelector('.mail')?.classList.toggle('is-selecting', selecting || selected.size > 0);
  if (!state.addresses?.length) {
    list.append(h('div', { style: { height: '100%', display: 'grid', placeItems: 'center' } },
      h('div', { class: 'empty' }, icon('mail'),
        h('div', { class: 'empty__t' }, t('noAccountsYet')),
        h('div', { class: 'empty__d' }, t('noAccountsSub')),
        h('button', { class: 'btn btn--primary mt-2', onclick: () => createAddressModal(() => loadAddresses()) }, icon('plus'), t('acctNew')))));
    return;
  }
  const visible = visibleEmails();
  if (!visible.length) {
    list.append(h('div', { style: { height: '100%', display: 'grid', placeItems: 'center' } },
      h('div', { class: 'empty' }, icon(box === 'inbox' ? 'inbox' : box === 'starred' ? 'star' : box === 'noted' ? 'note' : 'mail'),
        h('div', { class: 'empty__t' }, t('noEmails')), h('div', { class: 'empty__d' }, t('noEmailsSub')))));
    cursorIdx = -1;
    return;
  }
  visible.forEach((em, i) => {
    const row = emailRow(em);
    if (i === cursorIdx) row.classList.add('is-cursor');
    if (newFlashId && em.id === newFlashId && i === 0) row.classList.add('is-new');
    list.append(row);
  });
  if (newFlashId) setTimeout(() => { newFlashId = null; list.querySelector('.email-row.is-new')?.classList.remove('is-new'); }, 1600);
}

function emailRow(em) {
  const color = avatarColor(em.from_addr);
  const flags = h('div', { class: 'email-row__flags' });
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

  // per-row overflow menu — the touch-proof way to star / mark / delete
  const kebab = h('button', {
    class: 'email-row__kebab', title: t('more'), 'aria-label': t('more'),
    onclick: (e) => { e.stopPropagation(); vibrate(5); rowMenu(em); },
  }, icon('more'));

  const row = h('div', {
    class: `email-row ${em.is_read ? '' : 'is-unread'} ${selected.has(em.id) ? 'is-selected' : ''}`,
    dataset: { id: em.id },
    onclick: () => {
      if (selecting || selected.size) { toggleSelect(em.id); return; }
      cursorIdx = emails.findIndex((x) => x.id === em.id);
      // every email gets its own page — a real route, a real back button
      location.hash = `#/mail/m/${em.id}`;
    },
  },
    h('span', { class: 'select-box', onclick: (e) => { e.stopPropagation(); toggleSelect(em.id); } }),
    h('span', { class: 'email-row__ava', style: { background: color }, title: t('selHint'),
      onclick: (e) => { e.stopPropagation(); toggleSelect(em.id); } },
      (em.from_name || em.from_addr || '?').slice(0, 1).toUpperCase()),
    h('span', { class: 'email-row__body' },
      h('span', { class: 'email-row__top' },
        h('span', { class: 'email-row__from' }, em.from_name || em.from_addr),
        h('span', { class: 'email-row__end' }, starSlot, kebab, h('span', { class: 'email-row__time' }, timeAgo(em.received_at, t)))),
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

// ---------- per-row action sheet (touch-proof star / read / delete) ----------
function rowMenu(em) {
  let m = null;
  const act = (label, icn, fn, cls = 'btn') => h('button', {
    class: `${cls} menu-act`,
    onclick: () => { m.close(); fn(); },
  }, icon(icn), label);
  m = modal({
    title: (em.subject || '(no subject)').slice(0, 64), iconName: 'mail',
    body: [
      h('div', { class: 'menu-stack' },
        act(em.starred ? t('unstar') : t('star'), 'star', async () => {
          try { await api.patch(`/api/emails/${em.id}`, { starred: !em.starred }); loadEmails(true); } catch (e) { toast(errText(e), 'err'); }
        }),
        act(em.is_read ? t('markUnread') : t('markRead'), 'eye', async () => {
          try { await api.patch(`/api/emails/${em.id}`, { is_read: !em.is_read }); loadEmails(true); } catch (e) { toast(errText(e), 'err'); }
        }),
        act(t('delete'), 'trash', () => confirmBox(t('confirm'), async () => {
          try { await api.del(`/api/emails/${em.id}`); toast(t('deletedN'), 'ok', 1400); loadEmails(true); } catch (e) { toast(errText(e), 'err'); }
        }), 'btn btn--danger')),
    ],
    footer: [h('button', { class: 'btn btn--ghost', onclick: () => m.close() }, t('cancel'))],
  });
}

// ---------- keyboard navigation (j/k/Enter/x/s/Escape) ----------
document.addEventListener('keydown', (e) => {
  const onReader = !!document.querySelector('.reader');
  if (!document.getElementById('email-list') && !onReader) return;   // only in mail context
  if (document.querySelector('.modal-back, .cmdk-back, .menu')) return; // nothing overlaying
  const typing = /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable;
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

  if (onReader) {
    if (e.key === 'Escape') { e.preventDefault(); location.hash = '#/mail'; }
    return;
  }

  if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); moveCursor(1); }
  else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-1); }
  else if (e.key === 'Enter' || e.key === 'o') { openCursor(); }
  else if (e.key.toLowerCase() === 'x') { const em = visibleEmails()[cursorIdx]; if (em) { e.preventDefault(); toggleSelect(em.id); } }
  else if (e.key.toLowerCase() === 's') {
    const em = visibleEmails()[cursorIdx];
    if (em) {
      e.preventDefault(); vibrate(6);
      api.patch(`/api/emails/${em.id}`, { starred: !em.starred }).then(() => { em.starred = em.starred ? 0 : 1; loadEmails(true); }).catch(() => {});
    }
  }
  else if (e.key === 'Escape') {
    if (selected.size || selecting) { selected.clear(); selecting = false; drawList(); drawBulkBar(); }
  }
});

function moveCursor(dir) {
  const visible = visibleEmails();
  if (!visible.length) return;
  cursorIdx = Math.min(visible.length - 1, Math.max(0, cursorIdx + dir));
  drawList();
  document.querySelector('.email-row.is-cursor')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function openCursor() {
  const em = visibleEmails()[cursorIdx];
  if (!em) return;
  location.hash = `#/mail/m/${em.id}`;
}

/* ============================================================
   the dedicated email page — #/mail/m/:id
   a real route with a real back button, exactly like the big clients
   ============================================================ */
async function renderReader(root, id) {
  const wrap = h('div', { class: 'reader' });
  root.append(wrap);
  wrap.append(h('div', { class: 'reader__card glass card', style: { padding: '18px' } },
    h('div', { class: 'skel', style: { height: '26px', width: '55%' } }),
    h('div', { class: 'skel mt-2', style: { height: '220px' } })));

  let r;
  try { r = await api.get(`/api/emails/${id}`); }
  catch (e) {
    clear(wrap);
    wrap.append(h('div', { class: 'reader__top' }, backBtn()));
    wrap.append(h('div', { class: 'reader__card glass card reader__empty' },
      h('div', { class: 'empty' }, icon('mail'), h('div', { class: 'empty__t' }, t('error')), h('div', { class: 'empty__d' }, errText(e) || (e.message ?? '')))));
    return;
  }
  clear(wrap);
  await drawReader(wrap, r);

  // reading counts: refresh the unread badge quietly (shell listens)
  const me = await api.get('/api/auth/me').catch(() => null);
  if (me) { state.unread = me.unread ?? 0; window.dispatchEvent(new CustomEvent('cmail:unread-changed', { detail: state.unread })); }
}

function backBtn() {
  return h('button', { class: 'btn btn--ghost', onclick: () => { location.hash = '#/mail'; } },
    icon('arrow'), h('span', {}, t('backToInbox')));
}

async function drawReader(wrap, r) {
  const em = r.email;

  // ----- top bar: back · older/newer · star · delete -----
  let navIds = null;
  if (em.address_id) {
    try {
      const lr = await api.get(`/api/emails?address_id=${encodeURIComponent(em.address_id)}&limit=80`);
      const ids = (lr.emails ?? []).map((x) => x.id);
      const at = ids.indexOf(em.id);
      if (at > -1) navIds = { prev: ids[at + 1] ?? null, next: ids[at - 1] ?? null };
    } catch { /* context nav is best-effort */ }
  }

  const starBtn = h('button', { class: `btn btn--sm btn--ghost ${em.starred ? 'is-on' : ''}`, title: t('star') }, icon('star'), h('span', { class: 'hide-sm' }, t('star')));
  starBtn.onclick = async () => {
    const on = !em.starred;
    try {
      await api.patch(`/api/emails/${em.id}`, { starred: on });
      em.starred = on ? 1 : 0;
      starBtn.classList.toggle('is-on', on);
    } catch (e) { toast(errText(e), 'err'); }
  };
  const delBtn = h('button', { class: 'btn btn--sm btn--ghost', title: t('delete') }, icon('trash'), h('span', { class: 'hide-sm' }, t('delete')));
  delBtn.onclick = () => confirmBox(t('confirm'), async () => {
    try {
      await api.del(`/api/emails/${em.id}`);
      toast(t('deletedN'), 'ok', 1400);
      location.hash = '#/mail';
    } catch (e) { toast(errText(e), 'err'); }
  });

  const navBtns = h('div', { class: 'reader__navbtns' });
  navBtns.append(
    h('button', { class: 'btn btn--sm btn--ghost', title: t('olderEmail'), disabled: !navIds?.prev, onclick: () => { if (navIds?.prev) location.hash = `#/mail/m/${navIds.prev}`; } }, icon('chevron')),
    h('button', { class: 'btn btn--sm btn--ghost', title: t('newerEmail'), disabled: !navIds?.next, onclick: () => { if (navIds?.next) location.hash = `#/mail/m/${navIds.next}`; } }, icon('chevron', 'rot-180')),
  );

  wrap.append(h('div', { class: 'reader__top' },
    backBtn(),
    navBtns,
    starBtn, delBtn));

  // ----- the email card -----
  const card = h('div', { class: 'reader__card glass' });
  wrap.append(card);

  const actions = h('div', { class: 'viewer__actions' });
  // reply obeys the same sending lock as the compose button
  actions.append(
    h('button', {
      class: `btn btn--sm btn--ghost ${sendReady() ? '' : 'is-frozen'}`,
      title: sendReady() ? t('reply') : t('sendLockedTitle'),
      onclick: () => sendReady()
        ? openCompose({ to: em.from_addr, subject: `Re: ${em.subject ?? ''}` })
        : toast(t('sendLockedToast'), 'err'),
    }, icon('arrow'), h('span', { class: 'hide-sm' }, t('reply')), sendReady() ? '' : lockBadge('frozen', t('sendLockedTitle'))));
  actions.append(
    h('button', { class: 'btn btn--sm btn--ghost', title: t('markUnread'), onclick: async () => {
      try {
        await api.patch(`/api/emails/${em.id}`, { is_read: false });
        toast(t('saved'), 'ok', 1200);
        location.hash = '#/mail';
      } catch (e) { toast(errText(e), 'err'); }
    } }, icon('eye'), h('span', { class: 'hide-sm' }, t('markUnread'))),
    h('button', { class: 'btn btn--sm btn--ghost', title: t('copy'), onclick: async () => { await copyText(em.from_addr); toast(t('copied'), 'ok', 1400); } }, icon('copy')),
  );

  const meta = h('div', { class: 'viewer__meta' },
    h('span', { class: 'avatar', style: { background: avatarColor(em.from_addr), width: '38px', height: '38px', borderRadius: '12px' } }, (em.from_name || em.from_addr).slice(0, 1).toUpperCase()),
    h('div', { class: 'grow' },
      h('div', { style: { fontWeight: 700, fontSize: '13px' } }, em.from_name ? `${em.from_name} · ${em.from_addr}` : em.from_addr),
      h('div', { class: 'small muted' }, `${t('to')} ${em.to_addr} — ${new Date(em.received_at).toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-GB')}`)),
    actions);

  card.append(h('div', { class: 'viewer__head' },
    h('h2', { class: 'viewer__subj reader__subj' }, em.subject || '(no subject)'),
    meta));

  // attachments row (above body, mail-client style)
  if (r.attachments?.length) {
    card.append(h('div', { class: 'attachments' },
      r.attachments.map((a) => a.available
        ? h('a', { class: 'att-chip', href: `/api/emails/attachment/${a.id}`, download: a.filename ?? 'file' }, icon('download'), a.filename ?? 'file', h('span', { class: 'faint small' }, fmtBytes(a.size)))
        : h('span', { class: 'att-chip', title: t('attachmentTooBig'), style: { opacity: .5 } }, icon('paperclip'), a.filename ?? 'file'))));
  }

  // ----- render mode state -----
  let mode = em.html_body ? 'html' : 'text';
  let narrow = false;
  const bodyWrap = h('div', { class: 'viewer__body' });

  const seg = h('div', { class: 'seg' });
  const bHtml = h('button', { type: 'button' }, icon('eye'), t('viewRendered'));
  const bText = h('button', { type: 'button' }, icon('code'), t('viewSource'));
  const bWidth = h('button', { type: 'button', class: 'chip', title: t('viewNarrow') }, icon('columns'), h('span', { class: 'hide-sm' }, t('viewNarrow')));
  seg.append(bHtml, bText);

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

  card.append(h('div', { class: 'mtools' }, seg, bWidth));

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
      `<style>${mailFrameCss()}</style>${doc.head.innerHTML}</head>` +
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
      const frame = buildFrame();
      bodyWrap.append(h('div', { class: 'mail-frame-wrap' }, frame));
    } else {
      bodyWrap.append(h('div', { class: 'mail-frame-wrap' },
        h('div', { class: 'viewer__plain', style: { flex: '1', fontSize: '14.5px' } }, em.text_body || em.preview || '—')));
    }
  }
  drawBody();
  card.append(bodyWrap);

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
      try { await api.put(`/api/emails/${em.id}/note`, { body: noteBody.value, color: noteColor }); } catch (e) { toast(errText(e), 'err'); }
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
  card.append(notePanel);
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
function mailFrameCss() {
  return `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font: 14.5px/1.7 -apple-system, 'Segoe UI', 'Vazirmatn', Tahoma, sans-serif;
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

// ---------- compose ----------
export async function openCompose(prefill = {}) {
  // a double-click used to stack two composers — one is enough
  if (document.querySelector('.modal--compose')) return;
  if (!state.addresses.length) await api.get('/api/addresses').then((r) => state.addresses = r.addresses ?? []).catch(() => {});
  const fromSel = h('select', { class: 'input' },
    state.addresses.map((a) => h('option', { value: a.id, selected: a.id === state.currentAddressId || undefined }, a.address)));
  const to = h('input', { class: 'input ltr', placeholder: 'name@example.com', value: prefill.to ?? '' });
  const subj = h('input', { class: 'input', value: prefill.subject ?? '' });
  const body = h('textarea', { class: 'input', rows: 9, placeholder: t('body') });
  const btn = h('button', { class: 'btn btn--primary', type: 'submit' }, icon('send'), t('send'));

  const m = modal({
    title: t('composeTitle'), iconName: 'send', wide: false, cls: 'modal--compose',
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
  // only domains that finished their registration can hold a mailbox —
  // drafts and verifying ones stay out of the picker entirely
  const usable = state.domains.filter((d) => !d.status || d.status === 'verified' || d.status === 'unverified');
  if (!usable.length) {
    toast(t('noUsableDomain'), 'err');
    return;
  }

  let kind = 'temp';
  const kindRow = h('div', { class: 'row', style: { gap: '8px' } });
  const domainSel = h('select', { class: 'input' }, usable.map((d) => h('option', { value: d.name }, d.name)));
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
      localStorage.setItem('cmail_acct', r.address.id);
      toast(t('saved'), 'ok', 1400);
      m.close();
      onDone?.();
    } catch (e) { toast(errText(e), 'err'); btn.disabled = false; }
  });
}
