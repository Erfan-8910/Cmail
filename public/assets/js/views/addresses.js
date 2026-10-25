// Cmail — addresses management view
import { api, state, errText } from '../api.js';
import { t } from '../i18n.js';
import { h, clear, icon, toast, confirmBox, copyText, timeAgo, fmtCountdown, fmtDate } from '../ui.js';
import { createAddressModal } from './mail.js';

export async function renderAddresses(root) {
  const view = h('div', { class: 'view' });
  view.append(h('div', { class: 'page-head' },
    h('div', {}, h('div', { class: 'eyebrow' }, t('eyebrowAddresses')), h('h2', { class: 'page-title' }, t('addressesTitle')), h('div', { class: 'page-sub' }, t('addressesSub'))),
    h('button', { class: 'btn btn--primary', onclick: () => createAddressModal(load) }, icon('plus'), t('createAddress')),
  ));

  const grid = h('div', { class: 'glass', style: { padding: '8px', overflowX: 'auto' } });
  const table = h('table', { class: 'tbl' });
  grid.append(table);
  view.append(grid);
  root.append(view);

  async function load() {
    try {
      const r = await api.get('/api/addresses');
      state.addresses = r.addresses ?? [];
      draw();
    } catch (e) { toast(errText(e), 'err'); }
  }

  function draw() {
    clear(table);
    table.append(h('thead', {}, h('tr', {},
      h('th', {}, 'Address'), h('th', {}, t('addrKind')), h('th', {}, t('label')), h('th', {}, t('totalMail')), h('th', {}, t('lastMail')), h('th', {}, t('expires')), h('th', {}, ''))));
    const tb = h('tbody', {});
    for (const a of state.addresses) {
      const left = a.kind === 'temp' && a.expires_at ? a.expires_at - Date.now() : null;
      tb.append(h('tr', {},
        h('td', {}, h('button', { class: 'row mono clickable', style: { fontWeight: 700 }, onclick: () => { state.currentAddressId = a.id; location.hash = '#/mail'; } },
          h('span', { class: 'addr-item__dot', style: { background: a.kind === 'temp' ? '#fbbf24' : '#34d399' } }),
          a.address)),
        h('td', {}, h('span', { class: `kind-tag kind-tag--${a.kind === 'temp' ? 'temp' : 'perm'}` }, a.kind === 'temp' ? t('temporary') : t('permanent'))),
        h('td', {}, a.label ?? '—'),
        h('td', {}, String(a.total ?? 0)),
        h('td', {}, a.last_mail_at ? timeAgo(a.last_mail_at, t) : '—'),
        h('td', {}, left === null ? t('never') : fmtCountdown(left, t)),
        h('td', {}, h('div', { class: 'row', style: { gap: '2px', justifyContent: 'flex-end' } },
          h('button', { class: 'icon-btn', title: t('copy'), onclick: async () => { await copyText(a.address); toast(t('copied'), 'ok', 1400); } }, icon('copy')),
          h('button', { class: 'icon-btn', title: t('openInbox'), onclick: () => { state.currentAddressId = a.id; location.hash = '#/mail'; } }, icon('inbox')),
          a.kind === 'temp' ? h('button', { class: 'icon-btn', title: t('extend24'), onclick: async () => { await api.patch(`/api/addresses/${a.id}`, { extend_hours: 24 }); toast(t('saved'), 'ok', 1400); load(); } }, icon('clock')) : '',
          h('button', { class: 'icon-btn', title: t('forwarding'), onclick: () => forwardModal(a) }, icon('external')),
          h('button', { class: 'icon-btn', title: t('deleteAddress'), onclick: () => confirmBox(t('deleteAddressConfirm'), async () => { await api.del(`/api/addresses/${a.id}`); load(); toast(t('deletedN'), 'ok', 1500); }) }, icon('trash')),
        ))));
    }
    table.append(tb);
  }

  function forwardModal(a) {
    import('../ui.js').then(({ modal }) => {
      const fwd = h('input', { class: 'input ltr', value: a.forward_to ?? '', placeholder: 'backup@example.com' });
      const m = modal({
        title: t('forwarding'), iconName: 'external',
        body: [
          h('p', { class: 'small muted', style: { margin: 0 } }, t('forwardingHint')),
          h('div', { class: 'field' }, h('label', {}, `${t('forwarding')} — ${a.address}`), fwd),
        ],
        footer: [
          h('button', { class: 'btn btn--ghost', onclick: () => m.close() }, t('cancel')),
          h('button', { class: 'btn btn--primary', onclick: async () => {
            try { await api.patch(`/api/addresses/${a.id}`, { forward_to: fwd.value.trim() }); toast(t('saved'), 'ok', 1400); m.close(); }
            catch (e) { toast(errText(e), 'err'); }
          } }, t('save')),
        ],
      });
    });
  }

  await load();
  // live countdown refresh
  const iv = setInterval(() => { if (!document.body.contains(view)) { clearInterval(iv); return; } draw(); }, 60_000);
}
