// Cmail — mail view: 3-pane inbox (sidebar / list / viewer) + notes + compose
import { api, state, errText } from '../api.js';
import { t, lang } from '../i18n.js';
import { h, clear, icon, toast, modal, confirmBox, copyText, timeAgo, esc, avatarColor, fmtBytes } from '../ui.js';

let box = 'inbox';
let search = '';
let selected = new Set();
let pollTimer = null;
let viewerState = null;

export function renderMail(root, arg) {
  box = 'inbox';
  search = '';
  selected.clear();

  const view = h('div', { class: 'view view--full' });
  const grid = h('div', { class: 'mail' });

  const sidebar = buildSidebar();
  const listCol = buildList();
  const viewerCol = h('section', { class: 'mail__col glass mail__viewer-col viewer' }, emptyViewer());

  grid.append(sidebar, listCol, viewerCol);
  view.append(grid);
  view.append(h('button', { class: 'compose-fab', title: t('compose'), 'aria-label': t('compose'), onclick: () => openCompose() }, icon('send')));
  root.append(view);

  loadAddresses().then(() => {
    if (arg) openEmail(arg);
  });
}

function emptyViewer() {
  return h('div', { class: 'empty' }, icon('mail'), h('div', { class: 'empty__t' }, t('selectEmail')), h('div', { class: 'empty__d' }, t('selectEmailSub')));
}

// ---------- sidebar: addresses ----------
async function loadAddresses() {
  try {
    const r = await api.get('/api/addresses');
    state.addresses = r.addresses ?? [];
    if (!state.currentAddressId || !state.addresses.find((a) => a.id === state.currentAddressId)) {
      state.currentAddressId = state.addresses[0]?.id ?? null;
    }
    drawSidebar();
    drawList();
    if (state.currentAddressId) loadEmails();
  } catch (e) { toast(errText(e), 'err'); }
}

let sidebarScroll = null;
function buildSidebar() {
  const head = h('div', { class: 'mail__head' },
    h('h3', {}, icon('mail'), t('navAddresses')),
    h('div', { class: 'row', style: { gap: '2px' } },
      h('button', { class: 'icon-btn', title: t('newAlias'), onclick: () => createAddressModal(() => { loadAddresses(); }) }, icon('plus')),
      h('button', { class: 'icon-btn', title: t('navAddresses'), onclick: () => location.hash = '#/addresses' }, icon('external')),
    ));
  sidebarScroll = h('div', { class: 'mail__scroll', id: 'addr-list' });
  const aside = h('aside', { class: 'mail__col glass mail__sidebar' }, head, sidebarScroll);
  return aside;
}

function drawSidebar() {
  const box2 = clear(document.getElementById('addr-list') ?? sidebarScroll);
  for (const a of state.addresses) {
    const color = a.kind === 'temp' ? '#fbbf24' : '#34d399';
    box2.append(h('button', {
      class: `addr-item ${a.id === state.currentAddressId ? 'is-on' : ''}`,
      onclick: () => {
        state.currentAddressId = a.id;
        selected.clear();
        drawSidebar(); drawList(); loadEmails();
      },
    },
      h('span', { class: 'addr-item__dot', style: { background: color, opacity: a.id === state.currentAddressId ? 1 : .45 } }),
      h('span', { class: 'addr-item__body' },
        h('span', { class: 'addr-item__addr' }, a.address),
        h('span', { class: 'addr-item__meta' },
          h('span', { class: `kind-tag kind-tag--${a.kind === 'temp' ? 'temp' : 'perm'}` }, a.kind === 'temp' ? t('temporary') : t('permanent')),
          ' ', a.label ? `· ${a.label}` : '')),
      a.unread > 0 ? h('span', { class: 'addr-item__badge' }, a.unread > 9 ? '9+' : String(a.unread)) : ''));
  }
}

// ---------- list ----------
let listScroll = null;
let emails = [];

function buildList() {
  const head = h('div', { class: 'mail__head' },
    h('h3', {}, icon('inbox'), t('inbox')),
    h('div', { class: 'row', style: { gap: '2px' } },
      h('button', { class: 'icon-btn', title: t('navAddresses'), onclick: (e) => { e.currentTarget.closest('.mail').classList.toggle('show-sidebar'); }, dataset: { mobile: 'menu' } }, icon('menu')),
      h('button', { class: 'icon-btn', title: t('refresh'), onclick: (e) => { e.currentTarget.querySelector('svg')?.classList.add('spin'); loadEmails(true); setTimeout(() => document.querySelector('.icon-btn svg.spin')?.classList.remove('spin'), 700); } }, icon('refresh')),
      h('button', { class: 'icon-btn', title: t('newAlias'), onclick: () => createAddressModal(() => { loadAddresses(); }) }, icon('plus')),
    ));

  const searchInput = h('input', {
    class: 'input', type: 'search', placeholder: t('search'),
    style: { margin: '0 16px 8px', padding: '8px 14px', borderRadius: '12px' },
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
  const bulk = h('div', { class: 'filters hidden', id: 'bulk-bar' });
  listScroll.after(bulk);

  const sec = h('section', { class: 'mail__col glass mail__list-col' }, head, searchInput, filters, listScroll);
  return sec;
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
    h('button', { class: 'chip', onclick: () => bulkAction('delete') }, icon('trash'), t('deleteSel')),
    h('button', { class: 'chip', onclick: () => { selected.clear(); drawList(); } }, icon('x'), t('clearSel')),
  );
}

async function bulkAction(action) {
  try {
    await api.post('/api/emails/bulk', { ids: [...selected], action });
    toast(t('deletedN'), 'ok', 1600);
    selected.clear();
    drawList();
    loadEmails(true);
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
    emails = r.emails ?? [];
    drawList();
  } catch (e) { toast(errText(e), 'err'); }
}

function drawList() {
  const list = clear(document.getElementById('email-list') ?? listScroll);
  if (!emails.length) {
    list.append(h('div', { style: { height: '100%', display: 'grid', placeItems: 'center' } },
      h('div', { class: 'empty' }, icon('inbox'), h('div', { class: 'empty__t' }, t('noEmails')), h('div', { class: 'empty__d' }, t('noEmailsSub')))));
    return;
  }
  for (const em of emails) list.append(emailRow(em));
}

function emailRow(em) {
  const color = avatarColor(em.from_addr);
  const flags = h('div', { class: 'email-row__flags' });
  if (em.starred) flags.append(h('span', { class: 'flag-star' }, icon('star')));
  if (em.has_note) flags.append(h('span', { class: 'flag-note' }, icon('note')));
  if (em.size > 200_000) flags.append(h('span', { class: 'flag-clip' }, icon('paperclip')));

  return h('div', {
    class: `email-row ${em.is_read ? '' : 'is-unread'} ${selected.has(em.id) ? 'is-selected' : ''} ${viewerState === em.id ? 'is-active' : ''}`,
    dataset: { id: em.id },
    onclick: () => {
      if (selected.size) { toggleSelect(em.id); return; }
      viewerState = em.id;
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
        h('span', { class: 'email-row__time' }, timeAgo(em.received_at, t))),
      h('div', { class: 'email-row__subj' }, em.subject || '(no subject)'),
      h('div', { class: 'email-row__prev' }, em.preview || ''),
      flags.children.length ? flags : ''));
}

function toggleSelect(id) {
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  drawList();
  drawBulkBar();
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
    // refresh unread badge silently
    const me = await api.get('/api/auth/me').catch(() => null);
    if (me) { state.unread = me.unread ?? 0; }
  } catch (e) { toast(errText(e), 'err'); clear(col).append(emptyViewer()); }
}

function drawViewer(col, r) {
  const em = r.email;
  clear(col);

  const actions = h('div', { class: 'viewer__actions' });
  actions.append(
    h('button', { class: 'btn btn--sm btn--ghost', title: t('reply'), onclick: () => openCompose({ to: em.from_addr, subject: `Re: ${em.subject ?? ''}` }) }, icon('arrow'), h('span', {}, t('reply'))),
    h('button', { class: 'btn btn--sm btn--ghost', title: t('star'), onclick: async (e) => {
      const on = !em.starred;
      await api.patch(`/api/emails/${em.id}`, { starred: on });
      em.starred = on ? 1 : 0;
      e.currentTarget.classList.toggle('is-on', on);
      loadEmails(true);
    }, class: em.starred ? 'btn btn--sm btn--ghost is-on' : 'btn btn--sm btn--ghost' }, icon('star'), h('span', {}, t('star'))),
    h('button', { class: 'btn btn--sm btn--ghost', title: t('delete'), onclick: async () => {
      await api.del(`/api/emails/${em.id}`);
      toast(t('deletedN'), 'ok', 1500);
      clear(col).append(emptyViewer());
      loadEmails(true);
    } }, icon('trash'), h('span', {}, t('delete'))),
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

  // body
  const bodyWrap = h('div', { class: 'viewer__body' });
  if (em.html_body) {
    const frame = h('iframe', {
      class: 'mail-frame',
      sandbox: 'allow-popups',
      referrerpolicy: 'no-referrer',
    });
    frame.setAttribute('srcdoc',
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><base target="_blank">` +
      `<style>body{margin:14px;font:14px/1.65 -apple-system,'Segoe UI',sans-serif;color:#111;word-break:break-word}img{max-width:100%;height:auto}table{max-width:100%}a{color:#4f46e5}</style>` +
      `</head><body>${em.html_body}</body></html>`);
    bodyWrap.append(frame);
  } else {
    bodyWrap.append(h('div', { class: 'viewer__plain' }, em.text_body || '—'));
  }

  col.append(head);

  // attachments
  if (r.attachments?.length) {
    const atts = h('div', { class: 'attachments' },
      h('span', { class: 'small muted', style: { width: '100%' } }, `${t('attachments')} (${r.attachments.length})`),
      r.attachments.map((a) => a.available
        ? h('a', { class: 'att-chip', href: `/api/emails/attachment/${a.id}`, download: a.filename ?? 'file' }, icon('download'), a.filename ?? 'file', h('span', { class: 'faint small' }, fmtBytes(a.size)))
        : h('span', { class: 'att-chip', title: t('attachmentTooBig'), style: { opacity: .5 } }, icon('paperclip'), a.filename ?? 'file')));
    col.append(atts);
  }

  col.append(bodyWrap);

  // note panel
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

  col.append(h('div', { class: 'note-panel' },
    h('div', { class: 'note-panel__head' }, icon('note'), t('noteTitle')),
    noteBody, colorRow));

  // mobile back
  col.append(h('button', { class: 'btn btn--sm btn--ghost', style: { margin: '8px 14px 12px', alignSelf: 'flex-start' }, onclick: () => document.querySelector('.mail')?.classList.remove('show-viewer') }, icon('arrow'), h('span', {}, t('navMail'))));
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

  m.el.closest('.modal-back').querySelector('form, .modal__body')?.addEventListener('submit', () => {});
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

// ---------- create address modal (shared with addresses view) ----------
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
