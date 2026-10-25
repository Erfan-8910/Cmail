// Cmail — 2FA vault: named TOTP entries with live codes, glyphs and account scoping
import { api, state, errText } from '../api.js';
import { t } from '../i18n.js';
import { h, clear, icon, toast, modal, confirmBox, copyText, esc, glyphs, glyphCats, glyphTile, vibrate } from '../ui.js';

const COLORS = { violet: '#a78bfa', sky: '#38bdf8', mint: '#34d399', amber: '#fbbf24', rose: '#fb7185' };
let entries = [];
let tick = null;
let scope = 'all'; // 'all' | 'none' | address id

export async function renderVault(root) {
  const view = h('div', { class: 'view' });
  view.append(h('div', { class: 'page-head' },
    h('div', {}, h('div', { class: 'eyebrow' }, t('eyebrowVault')), h('h2', { class: 'page-title' }, t('vaultTitle')), h('div', { class: 'page-sub' }, t('vaultSub'))),
    h('button', { class: 'btn btn--primary', onclick: () => entryModal() }, icon('plus'), t('addCode')),
  ));

  const chips = h('div', { class: 'vault-filters' });
  const searchIn = h('input', { class: 'input', type: 'search', placeholder: t('searchVault'), style: { marginBottom: '14px' } });
  searchIn.addEventListener('input', () => draw(searchIn.value.trim().toLowerCase()));

  const grid = h('div', { class: 'vault-grid', id: 'vault-grid' });
  view.append(chips, searchIn, grid);
  root.append(view);

  if (!state.addresses.length) {
    await api.get('/api/addresses').then((r) => state.addresses = r.addresses ?? []).catch(() => {});
  }

  await load();

  clearInterval(tick);
  tick = setInterval(() => {
    if (!document.body.contains(grid)) { clearInterval(tick); return; }
    updateRings();
  }, 1000);

  function drawChips() {
    clear(chips);
    const mk = (key, label, dot) => h('button', {
      class: `chip ${scope === key ? 'is-on' : ''}`,
      onclick: (e) => { scope = key; chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-on')); e.currentTarget.classList.add('is-on'); vibrate(5); draw(); },
    }, dot ? h('span', { class: 'chip-dot', style: { background: dot } }, '') : '', label);
    chips.append(mk('all', t('acctAll'), 'var(--acc)'));
    for (const a of state.addresses) {
      chips.append(mk(a.id, a.label || a.address, a.kind === 'temp' ? 'var(--warn)' : 'var(--acc)'));
    }
    chips.append(mk('none', t('acctUnlinked'), 'var(--faint)'));
  }

  async function load() {
    try {
      const r = await api.get('/api/totp');
      entries = r.entries ?? [];
      drawChips();
      draw();
    } catch (e) { toast(errText(e), 'err'); }
  }

  function draw(q = '') {
    drawChips();
    const g = clear(document.getElementById('vault-grid') ?? grid);
    let list = entries.filter((e) => !q || (e.name + ' ' + (e.issuer ?? '')).toLowerCase().includes(q));
    if (scope === 'none') list = list.filter((e) => !e.address_id);
    else if (scope !== 'all') list = list.filter((e) => e.address_id === scope);
    if (!list.length) {
      g.append(h('div', { class: 'glass card', style: { gridColumn: '1/-1' } },
        h('div', { class: 'empty' }, icon('key'), h('div', { class: 'empty__t' }, t('vaultEmpty')), h('div', { class: 'empty__d' }, t('vaultEmptySub')))));
      return;
    }
    for (const e of list) g.append(totpCard(e));
  }

  function totpCard(e) {
    const color = COLORS[e.color] ?? e.color ?? '#7c8cff';
    const acc = state.addresses.find((a) => a.id === e.address_id);
    const codeEl = h('div', { class: 'totp-code', dataset: { id: e.id }, html: formatCode(e.code ?? '', e.digits) });
    const ring = ringSvg(e.remaining ?? 0, e.period ?? 30, color);

    const card = h('div', { class: 'glass totp-card', style: { '--tc': color }, dataset: { id: e.id, period: e.period ?? 30 } },
      h('div', { class: 'totp-card__top' },
        glyphTile(e.icon, color, (e.issuer || e.name).slice(0, 1)),
        h('div', { class: 'grow' },
          h('div', { class: 'totp-card__name' }, e.name),
          h('div', { class: 'totp-card__issuer' }, e.issuer ?? '')),
        h('div', { class: 'row', style: { gap: '0' } },
          h('button', { class: 'icon-btn', title: t('edit'), onclick: (ev) => { ev.stopPropagation(); entryModal(e, { onDone: load }); } }, icon('edit')),
          h('button', { class: 'icon-btn', title: t('deleteEntry'), onclick: (ev) => { ev.stopPropagation(); confirmBox(t('deleteEntryConfirm'), async () => { await api.del(`/api/totp/${e.id}`); entries = entries.filter((x) => x.id !== e.id); draw(); toast(t('deletedN'), 'ok', 1500); }); } }, icon('trash')),
        )),
      acc ? h('button', {
        class: 'totp-card__acc chip', onclick: () => { location.hash = '#/mail'; },
      }, h('span', { class: 'chip-dot', style: { background: acc.kind === 'temp' ? 'var(--warn)' : 'var(--acc)' } }, ''), `${t('acctLinked')} — ${acc.address}`) : '',
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

// ---------- glyph picker: 48 built-in marks, grouped ----------
function glyphPicker(current, onPick) {
  const wrap = h('div', { class: 'glyph-picker' });
  const grid = h('div', { class: 'glyph-picker__grid' });

  function drawGrid(catKey) {
    clear(grid);
    const catLabel = h('div', { class: 'glyph-picker__cat' }, t(`cat_${catKey}`));
    grid.append(catLabel);
    for (const id of glyphCats[catKey]) {
      const b = h('button', {
        type: 'button', class: `glyph-cell ${current === id ? 'is-on' : ''}`, title: id,
        onclick: () => { onPick(id); wrap.querySelectorAll('.glyph-cell').forEach((c) => c.classList.remove('is-on')); b.classList.add('is-on'); },
      }, h('span', { class: 'glyph-cell__mark', html: glyphs[id] }));
      grid.append(b);
    }
  }

  const tabs = h('div', { class: 'glyph-picker__tabs' });
  const first = Object.keys(glyphCats)[0];
  for (const key of Object.keys(glyphCats)) {
    tabs.append(h('button', {
      type: 'button', class: `chip ${key === first ? 'is-on' : ''}`,
      onclick: (e) => { tabs.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-on')); e.currentTarget.classList.add('is-on'); drawGrid(key); },
    }, t(`cat_${key}`)));
  }
  wrap.append(tabs, grid);
  drawGrid(first);
  return wrap;
}

// ---------- add/edit modal ----------
export function entryModal(entry = null, opts = {}) {
  const name = h('input', { class: 'input', value: entry?.name ?? '', placeholder: t('entryName') });
  const issuer = h('input', { class: 'input', value: entry?.issuer ?? '', placeholder: 'GitHub' });
  const secret = h('input', { class: 'input ltr mono', placeholder: 'JBSWY3DPEHPK3PXP' });
  const uri = h('input', { class: 'input ltr mono', placeholder: 'otpauth://totp/…' });
  const algo = h('select', { class: 'input' }, ['SHA1', 'SHA256', 'SHA512'].map((a) => h('option', { value: a, selected: (entry?.algo ?? 'SHA1') === a || undefined }, a)));
  const digits = h('select', { class: 'input' }, [6, 8].map((d) => h('option', { value: d, selected: (entry?.digits ?? 6) === d || undefined }, String(d))));
  const period = h('input', { class: 'input', type: 'number', min: 15, max: 120, value: entry?.period ?? 30 });
  let color = entry?.color ?? 'violet';
  let glyph = entry?.icon ?? null;
  let addressId = entry?.address_id ?? opts.addressId ?? null;
  const colorRow = h('div', { class: 'row' });
  for (const [k, v] of Object.entries(COLORS)) {
    colorRow.append(h('button', {
      class: `note-dot ${`note-dot--${k}`} ${color === k ? 'is-on' : ''}`,
      style: { background: v },
      onclick: (e) => { color = k; colorRow.querySelectorAll('.note-dot').forEach((d) => d.classList.remove('is-on')); e.currentTarget.classList.add('is-on'); },
    }));
  }

  // glyph preview + picker toggle
  const preview = glyphTile(glyph, COLORS[color] ?? color, (issuer.value || name.value || '?').slice(0, 1));
  const pickBtn = h('button', { class: 'btn btn--sm', type: 'button', onclick: () => pickerWrap.classList.toggle('is-open') }, icon('spark'), t('glyphPick'));
  const pickerWrap = h('div', { class: 'glyph-picker-wrap' });
  pickerWrap.append(glyphPicker(glyph, (id) => {
    glyph = (glyph === id) ? null : id;
    clear(preview);
    const fresh = glyphTile(glyph, COLORS[color] ?? color, (issuer.value || name.value || '?').slice(0, 1));
    preview.className = fresh.className;
    preview.setAttribute('style', fresh.getAttribute('style') ?? '');
    preview.append(...fresh.childNodes);
    pickerWrap.classList.remove('is-open');
  }));

  // mailbox link (its 2FA then lives on that account only)
  const addrSel = h('select', { class: 'input' },
    h('option', { value: '', selected: !addressId || undefined }, t('acctUnlinked')),
    state.addresses.map((a) => h('option', { value: a.id, selected: a.id === addressId || undefined }, a.label || a.address)));
  addrSel.addEventListener('change', () => { addressId = addrSel.value || null; });

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

  const refreshCard = () => { vibrate(6); if (opts.onDone) opts.onDone(); };

  const saveBtn = entry
    ? h('button', { class: 'btn btn--primary', onclick: async () => {
        try {
          await api.patch(`/api/totp/${entry.id}`, { name: name.value.trim(), issuer: issuer.value.trim(), color, icon: glyph, address_id: addressId });
          toast(t('saved'), 'ok', 1400); m.close(); refreshCard();
        } catch (e) { toast(errText(e), 'err'); }
      } }, t('save'))
    : h('button', { class: 'btn btn--primary', onclick: async () => {
        saveBtn.disabled = true;
        try {
          await api.post('/api/totp', {
            name: name.value.trim(), issuer: issuer.value.trim(),
            secret: secret.value.trim(), uri: uri.value.trim(),
            algo: algo.value, digits: parseInt(digits.value, 10), period: parseInt(period.value, 10) || 30,
            color, icon: glyph, address_id: addressId,
          });
          toast(t('saved'), 'ok', 1400); m.close(); refreshCard();
        } catch (e) { toast(errText(e), 'err'); saveBtn.disabled = false; }
      } }, icon('plus'), t('addCode'));

  const extraRow = h('div', { class: 'row row--wrap' }, qrBtn, secretBtn);

  const m = modal({
    title: entry ? t('edit') : t('addCode'), iconName: 'key',
    body: [
      h('div', { class: 'row', style: { alignItems: 'center', gap: '12px' } },
        preview,
        h('div', { class: 'grow' },
          h('div', { class: 'field' }, h('label', {}, t('entryName')), name),
          h('div', { class: 'field' }, h('label', {}, t('issuer')), issuer)),
        h('div', { style: { alignSelf: 'flex-end', paddingBottom: '2px' } }, pickBtn)),
      pickerWrap,
      ...secretFields,
      h('div', { class: 'field' }, h('label', {}, t('acct2fa')), addrSel),
      h('div', { class: 'field' }, h('label', {}, t('color')), colorRow),
      extraRow,
    ],
    footer: [h('button', { class: 'btn btn--ghost', onclick: () => m.close() }, t('cancel')), saveBtn],
  });
}
