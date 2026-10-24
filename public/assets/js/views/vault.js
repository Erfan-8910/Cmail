// Cmail — 2FA vault view: named TOTP entries with live codes
import { api, errText } from '../api.js';
import { t } from '../i18n.js';
import { h, clear, icon, toast, modal, confirmBox, copyText, esc } from '../ui.js';

const COLORS = { violet: '#a78bfa', sky: '#38bdf8', mint: '#34d399', amber: '#fbbf24', rose: '#fb7185' };
let entries = [];
let tick = null;

export async function renderVault(root) {
  const view = h('div', { class: 'view' });
  view.append(h('div', { class: 'page-head' },
    h('div', {}, h('h2', { class: 'page-title' }, icon('key'), t('vaultTitle')), h('div', { class: 'page-sub' }, t('vaultSub'))),
    h('button', { class: 'btn btn--primary', onclick: () => entryModal() }, icon('plus'), t('addCode')),
  ));

  const searchIn = h('input', { class: 'input', type: 'search', placeholder: t('searchVault'), style: { marginBottom: '14px' } });
  searchIn.addEventListener('input', () => draw(searchIn.value.trim().toLowerCase()));

  const grid = h('div', { class: 'vault-grid', id: 'vault-grid' });
  view.append(searchIn, grid);
  root.append(view);

  await load();

  clearInterval(tick);
  tick = setInterval(() => {
    if (!document.body.contains(grid)) { clearInterval(tick); return; }
    updateRings();
  }, 1000);

  async function load() {
    try {
      const r = await api.get('/api/totp');
      entries = r.entries ?? [];
      draw();
    } catch (e) { toast(errText(e), 'err'); }
  }

  function draw(q = '') {
    const g = clear(document.getElementById('vault-grid') ?? grid);
    const list = entries.filter((e) => !q || (e.name + ' ' + (e.issuer ?? '')).toLowerCase().includes(q));
    if (!list.length) {
      g.append(h('div', { class: 'glass card', style: { gridColumn: '1/-1' } },
        h('div', { class: 'empty' }, icon('key'), h('div', { class: 'empty__t' }, t('vaultEmpty')), h('div', { class: 'empty__d' }, t('vaultEmptySub')))));
      return;
    }
    for (const e of list) g.append(totpCard(e));
  }

  function totpCard(e) {
    const color = COLORS[e.color] ?? e.color ?? '#7c8cff';
    const codeEl = h('div', { class: 'totp-code', dataset: { id: e.id }, html: formatCode(e.code ?? '', e.digits) });
    const ring = ringSvg(e.remaining ?? 0, e.period ?? 30, color);

    const card = h('div', { class: 'glass totp-card', style: { '--tc': color }, dataset: { id: e.id, period: e.period ?? 30 } },
      h('div', { class: 'totp-card__top' },
        h('span', { class: 'totp-card__icon', style: { background: color } }, (e.issuer || e.name).slice(0, 1).toUpperCase()),
        h('div', { class: 'grow' },
          h('div', { class: 'totp-card__name' }, e.name),
          h('div', { class: 'totp-card__issuer' }, e.issuer ?? '')),
        h('div', { class: 'row', style: { gap: '0' } },
          h('button', { class: 'icon-btn', title: t('edit'), onclick: (ev) => { ev.stopPropagation(); entryModal(e); } }, icon('edit')),
          h('button', { class: 'icon-btn', title: t('deleteEntry'), onclick: (ev) => { ev.stopPropagation(); confirmBox(t('deleteEntryConfirm'), async () => { await api.del(`/api/totp/${e.id}`); entries = entries.filter((x) => x.id !== e.id); draw(); toast(t('deletedN'), 'ok', 1500); }); } }, icon('trash')),
        )),
      h('div', { class: 'totp-card__code-row' },
        codeEl, ring));

    card.addEventListener('click', async () => {
      if (e.code) { await copyText(e.code); toast(t('codeCopied'), 'ok', 1400); }
    });

    // periodic refresh per entry
    const iv = setInterval(async () => {
      if (!document.body.contains(card)) { clearInterval(iv); return; }
      if ((e.remaining ?? 0) <= 1) {
        try {
          const r = await api.get('/api/totp/codes');
          for (const c of r.codes ?? []) {
            const entry = entries.find((x) => x.id === c.id);
            if (entry) { entry.code = c.code; entry.remaining = c.remaining; }
          }
          codeEl.innerHTML = formatCode(e.code ?? '', e.digits);
        } catch { /* ignore */ }
      }
    }, 1000);

    return card;
  }

  function ringSvg(remaining, period, color) {
    const R = 14;
    const C = 2 * Math.PI * R;
    const svg = h('svg', { class: 'totp-ring', viewBox: '0 0 34 34', style: { '--tc': color } });
    svg.append(
      h('circle', { class: 'bg', cx: 17, cy: 17, r: R }),
      h('circle', { class: 'fg', cx: 17, cy: 17, r: R, 'stroke-dasharray': String(C), 'stroke-dashoffset': String(C * (1 - remaining / period)) }),
    );
    svg.dataset.remaining = remaining;
    svg.dataset.period = period;
    return svg;
  }

  function updateRings() {
    document.querySelectorAll('.totp-ring').forEach((svg) => {
      const R = 14, C = 2 * Math.PI * R;
      let rem = Number(svg.dataset.remaining) - 1;
      const period = Number(svg.dataset.period);
      if (rem <= 0) rem = period; // wrap handled by codes refresh
      svg.dataset.remaining = rem;
      svg.querySelector('.fg')?.setAttribute('stroke-dashoffset', String(C * (1 - rem / period)));
    });
    // also decrement in-memory remaining
    for (const e of entries) e.remaining = Math.max(0, (e.remaining ?? 1) - 1);
  }
}

function formatCode(code, digits = 6) {
  if (!code) return '<span class="dim">——————</span>';
  const mid = Math.ceil(code.length / 2);
  return `${esc(code.slice(0, mid))} <span class="dim">${esc(code.slice(mid))}</span>`;
}

// ---------- add/edit modal ----------
function entryModal(entry = null) {
  const name = h('input', { class: 'input', value: entry?.name ?? '', placeholder: t('entryName') });
  const issuer = h('input', { class: 'input', value: entry?.issuer ?? '', placeholder: 'GitHub' });
  const secret = h('input', { class: 'input ltr mono', placeholder: 'JBSWY3DPEHPK3PXP' });
  const uri = h('input', { class: 'input ltr mono', placeholder: 'otpauth://totp/…' });
  const algo = h('select', { class: 'input' }, ['SHA1', 'SHA256', 'SHA512'].map((a) => h('option', { value: a, selected: (entry?.algo ?? 'SHA1') === a || undefined }, a)));
  const digits = h('select', { class: 'input' }, [6, 8].map((d) => h('option', { value: d, selected: (entry?.digits ?? 6) === d || undefined }, String(d))));
  const period = h('input', { class: 'input', type: 'number', min: 15, max: 120, value: entry?.period ?? 30 });
  let color = entry?.color ?? 'violet';
  const colorRow = h('div', { class: 'row' });
  for (const [k, v] of Object.entries(COLORS)) {
    colorRow.append(h('button', {
      class: `note-dot ${`note-dot--${k}`} ${color === k ? 'is-on' : ''}`,
      style: { background: v },
      onclick: (e) => { color = k; colorRow.querySelectorAll('.note-dot').forEach((d) => d.classList.remove('is-on')); e.currentTarget.classList.add('is-on'); },
    }));
  }

  const secretFields = entry ? [] : [
    h('div', { class: 'field' }, h('label', {}, t('secret')), secret),
    h('div', { class: 'field' }, h('label', {}, t('orPasteUri')), uri),
    h('div', { class: 'row row--wrap' },
      h('div', { class: 'field grow' }, h('label', {}, t('algo')), algo),
      h('div', { class: 'field grow' }, h('label', {}, t('digits')), digits),
      h('div', { class: 'field grow' }, h('label', {}, t('period')), period)),
  ];

  const qrBtn = entry ? h('button', { class: 'btn', type: 'button', onclick: async () => {
    const w = window.open(`/api/totp/${entry.id}/qr`, '_blank', 'width=380,height=480');
    if (!w) toast(t('error'), 'err');
  } }, icon('qr'), t('qr')) : null;

  const secretBtn = entry ? h('button', { class: 'btn', type: 'button', onclick: async () => {
    try {
      const r = await api.get(`/api/totp/${entry.id}/secret`);
      const m2 = modal({
        title: t('showSecret'), iconName: 'key',
        body: [h('div', { class: 'copy-line' }, h('span', {}, r.secret),
          h('button', { class: 'btn btn--sm btn--ghost', onclick: async () => { await copyText(r.secret); toast(t('copied'), 'ok', 1400); } }, icon('copy')))],
      });
    } catch (e) { toast(errText(e), 'err'); }
  } }, icon('eye'), t('showSecret')) : null;

  const saveBtn = entry
    ? h('button', { class: 'btn btn--primary', onclick: async () => {
        try {
          await api.patch(`/api/totp/${entry.id}`, { name: name.value.trim(), issuer: issuer.value.trim(), color });
          toast(t('saved'), 'ok', 1400); m.close(); location.reload();
        } catch (e) { toast(errText(e), 'err'); }
      } }, t('save'))
    : h('button', { class: 'btn btn--primary', onclick: async () => {
        saveBtn.disabled = true;
        try {
          await api.post('/api/totp', {
            name: name.value.trim(), issuer: issuer.value.trim(),
            secret: secret.value.trim(), uri: uri.value.trim(),
            algo: algo.value, digits: parseInt(digits.value, 10), period: parseInt(period.value, 10) || 30,
            color,
          });
          toast(t('saved'), 'ok', 1400); m.close();
          location.reload();
        } catch (e) { toast(errText(e), 'err'); saveBtn.disabled = false; }
      } }, icon('plus'), t('addCode'));

  const extraRow = h('div', { class: 'row row--wrap' }, qrBtn, secretBtn);

  const m = modal({
    title: entry ? t('edit') : t('addCode'), iconName: 'key',
    body: [
      h('div', { class: 'field' }, h('label', {}, t('entryName')), name),
      h('div', { class: 'field' }, h('label', {}, t('issuer')), issuer),
      ...secretFields,
      h('div', { class: 'field' }, h('label', {}, t('color')), colorRow),
      extraRow,
    ],
    footer: [h('button', { class: 'btn btn--ghost', onclick: () => m.close() }, t('cancel')), saveBtn],
  });
}
