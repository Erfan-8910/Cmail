// Cmail — print studio (v3.2.1): the letter on paper, ready for PDF.
// One press on “Print / PDF” builds a complete standalone document inside a
// hidden iframe — textured paper, a double-ruled frame, the letterhead that
// carries Cmail's own mark (or the admin's uploaded one), the official seal
// from the house sample with the device's exact date and time beside it, and
// a full certificate block: parties, mailbox, size, route, and the SPF ·
// DKIM · DMARC verdicts lifted from the delivery headers.
// Everything lives in the iframe's own <style>, so the app's glass UI can
// never leak into the page and the print dialog sees a pure paper world.
import { api } from './api.js';
import { t, lang } from './i18n.js';
import { sanitizeEmailHtml } from './mailtext.js';

// ---------- the letterhead mark (admin-uploaded, cached a minute) ----------
let logoCache = { at: 0, logo: null };
async function getPrintLogo(force = false) {
  if (!force && logoCache.logo !== null && Date.now() - logoCache.at < 60_000) return logoCache.logo;
  try {
    const r = await api.get('/api/emails/print-identity');
    logoCache = { at: Date.now(), logo: r.logo || null };
  } catch { logoCache = { at: Date.now(), logo: null }; }
  return logoCache.logo;
}
export function invalidatePrintLogo() { logoCache = { at: 0, logo: null }; }

// the seal and the mark ride the worker's own assets — same-origin paths the
// srcdoc iframe resolves against the app, so nothing depends on network luck
const SEAL_SRC = 'assets/img/seal-official.png';
const MARK_SRC = 'assets/img/mark-dark.png';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// the wavy cancellation lines the postman drags across the seal corner
function wavesSvg() {
  const wave = (y) => `M0 ${y} q 14 -7 28 0 t 28 0 t 28 0 t 28 0 t 28 0 t 28 0 t 28 0`;
  return `<svg class="stamp-waves" viewBox="0 0 168 66" width="150" height="59" aria-hidden="true">
    <g fill="none" stroke="var(--seal-ink)" stroke-width="2.4" stroke-linecap="round" opacity=".8">
      <path d="${wave(8)}"/><path d="${wave(24)}"/><path d="${wave(40)}"/><path d="${wave(56)}"/>
    </g>
  </svg>`;
}

// the plaque that carries the device's exact date and time — calendar · date
// | clock · time, in the seal's own ink. Persian digits when the panel is fa.
// Built as HTML (not SVG text): bidi inside SVG <text> reorders Persian
// digits unpredictably; isolated LTR cells keep both stamps honest.
function plaqueHtml(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  let dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  let timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  if (lang === 'fa') {
    const FA = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
    dateStr = FA(dateStr); timeStr = FA(timeStr);
  }
  const cal = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><g fill="none" stroke="var(--seal-ink)" stroke-width="1.8"><rect x="1.5" y="2.5" width="13" height="11.5" rx="2"/><path d="M1.5 6h13M5 1v3M11 1v3"/></g></svg>`;
  const clock = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><g fill="none" stroke="var(--seal-ink)" stroke-width="1.8"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.4 1.6"/></g></svg>`;
  return `
  <div class="seal-plaque">
    <span class="plaque__cell"><bdi dir="ltr">${dateStr}</bdi>${cal}</span>
    <span class="plaque__div"></span>
    <span class="plaque__cell"><bdi dir="ltr">${timeStr}</bdi>${clock}</span>
  </div>`;
}

function paperTextureCss() {
  // three quiet layers: paper grain (turbulence), faint laid lines, and a
  // soft vignette — the page reads as fiber paper, never as a screenshot
  const grain = "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' seed='4'/><feColorMatrix type='matrix' values='0 0 0 0 0.42 0 0 0 0 0.4 0 0 0 0 0.35 0 0 0 0.05 0'/></filter><rect width='240' height='240' filter='url(#g)'/></svg>`);
  const laid = "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='none'/><path d='M0 1.2h8M0 5.6h8' stroke='rgba(90,82,60,0.05)' stroke-width='0.6'/></svg>`);
  return `background-image:url("${grain}"),url("${laid}");`;
}

// ---------- the certificate rows ----------
function certRow(k, v, cls = '') {
  if (!v) return '';
  return `<div class="cert__row ${cls}"><span class="cert__k">${esc(k)}</span><span class="cert__v">${esc(v)}</span></div>`;
}

function authChips(headers) {
  const raw = (Array.isArray(headers) ? headers : [])
    .filter((h2) => ['authentication-results', 'arc-authentication-results', 'received-spf'].includes(h2.k))
    .map((h2) => h2.v).join(' ');
  const verdict = (re) => raw.match(re)?.[1]?.toLowerCase() ?? null;
  const spf = verdict(/\bspf\s*=\s*(pass|fail|softfail|neutral|none|temperror|permerror)/i);
  const dkim = verdict(/\bdkim\s*=\s*(pass|fail|none|temperror|permerror)/i);
  const dmarc = verdict(/\bdmarc\s*=\s*(pass|fail|none|temperror|permerror)/i);
  const chips = [['SPF', spf], ['DKIM', dkim], ['DMARC', dmarc]].filter(([, v]) => v)
    .map(([name, v]) => `<span class="auth-chip ${v === 'pass' ? 'is-pass' : 'is-warn'}">${name} · ${esc(v)}</span>`)
    .join('');
  return chips || '';
}

function fmtBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------- the document ----------
function buildPrintDoc(em, atts, note, logo, headers) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  // the document speaks the PANEL's language — a Persian panel prints a fully
  // RTL certificate even for an English letter, and the other way around
  const dir = lang === 'fa' ? 'rtl' : 'ltr';
  const FA = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
  const dstr = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return lang === 'fa' ? FA(s) : s;
  };
  const stampAt = lang === 'fa'
    ? FA(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`)
    : `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  // body: rendered text for plain letters; sanitized html for rich ones
  let bodyHtml = '';
  if (em.html_body) {
    const doc = sanitizeEmailHtml(em.html_body);
    bodyHtml = `<div class="letter-body">${doc.body.innerHTML}</div>`;
  } else {
    bodyHtml = `<div class="letter-body letter-body--plain">${esc(em.text_body || t('printNoBody'))}</div>`;
  }

  const outgoing = em.direction === 'out';
  const authHtml = authChips(headers);
  const attChips = (atts || []).map((a) =>
    `<span class="att-chip">${esc(a.filename || 'file')}${a.size ? `<i>${esc(fmtBytes(a.size))}</i>` : ''}</span>`).join('');
  const attRow = attChips ? `<div class="cert__row cert__row--wide"><span class="cert__k">${esc(t('printAtts'))}</span><span class="att-list">${attChips}</span></div>` : '';
  const noteRow = note?.body
    ? `<div class="note-block"><span class="note-block__k">${esc(t('printNote'))}</span><p>${esc(note.body)}</p></div>`
    : '';

  const cert = `
  <div class="cert">
    ${certRow(t('printStampOf'), outgoing ? em.from_addr : (em.from_name ? `${em.from_name} · ${em.from_addr}` : em.from_addr))}
    ${certRow(t('printStampTo'), em.to_addr)}
    ${certRow(t('printStampDate'), dstr(em.received_at))}
    ${certRow(t('printMailbox'), em.address_label ? `${em.address} — ${em.address_label}` : em.address)}
    ${certRow(t('printType'), outgoing ? t('printTypeOut') : t('printTypeIn'))}
    ${certRow(t('detailsSize'), fmtBytes(em.size ?? 0))}
    ${outgoing && em.provider ? certRow(t('detailsVia'), em.provider) : ''}
    ${authHtml ? `<div class="cert__row"><span class="cert__k">${esc(t('detailsAuth'))}</span><span class="auth-list">${authHtml}</span></div>` : ''}
    ${attRow}
  </div>
  ${noteRow}`;

  const stampSide = dir === 'rtl' ? 'left' : 'right';
  const mark = logo
    ? `<img class="lh-logo" src="${logo}" alt=""/>`
    : `<img class="lh-logo" src="${MARK_SRC}" alt=""/>`;
  const sealPos = dir === 'rtl' ? 'left: 9mm' : 'right: 9mm';

  return `<!doctype html>
<html dir="${dir}" lang="${lang}">
<head>
<meta charset="utf-8">
<title>${esc(em.subject || 'Cmail')}</title>
<style>
  @font-face {
    font-family: 'Vazirmatn';
    src: url('assets/fonts/Vazirmatn-var.woff2') format('woff2-variations');
    font-weight: 100 900; font-display: swap;
  }
  :root {
    --ink: #262b26; --ink-soft: #5c6157; --line: #c9c3b2; --line-soft: #e2ddd0;
    --paper: #f9f7f1; --seal-ink: #0a1294;
  }
  * { box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body { background: #ecebe6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .paper {
    position: relative; width: 210mm; min-height: 297mm; margin: 0 auto;
    background: var(--paper); color: var(--ink);
    box-shadow: 0 2px 18px rgba(40,36,24,.14);
    padding: 19mm 17mm 22mm;
    font-family: 'Vazirmatn', 'Segoe UI', Tahoma, sans-serif;
    font-size: 13.2px; line-height: 1.85;
  }
  ${paperTextureCss()}
  .paper::before {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background:
      radial-gradient(120% 90% at 50% 0%, rgba(255,255,255,.5), transparent 55%),
      radial-gradient(130% 110% at 50% 108%, rgba(120,104,64,.075), transparent 58%);
  }
  /* the double certificate frame — outer 1.6pt rule, inner hairline */
  .paper::after {
    content: ''; position: absolute; inset: 8mm; pointer-events: none;
    border: 1.6pt solid var(--ink); border-radius: 2px;
    outline: 1px solid var(--line); outline-offset: 3px;
  }
  /* the ghost of the house mark behind the text */
  .watermark {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 118mm; opacity: .045; pointer-events: none;
  }
  /* ---------- letterhead ---------- */
  .lh { position: relative; display: flex; align-items: center; gap: 12px; padding-bottom: 12px; }
  .lh-logo { width: 48px; height: 48px; object-fit: contain; }
  .lh-name { font-size: 21px; font-weight: 800; letter-spacing: -.2px; }
  .lh-sub { font-size: 10.5px; color: var(--ink-soft); letter-spacing: .12em; text-transform: uppercase; }
  .lh-rule {
    height: 0; border-top: 2px solid var(--ink); border-bottom: 1px solid var(--line);
    margin: 0 0 14px; position: relative;
  }
  /* ---------- the seal corner: the house seal + waves + device plaque ---------- */
  .seal-corner {
    position: absolute; top: 10mm; ${sealPos}; width: 172px;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    transform: rotate(${dir === 'rtl' ? '7' : '-7'}deg);
  }
  .seal-corner .seal-img { width: 148px; height: 148px; object-fit: contain; opacity: .96; }
  .seal-corner .stamp-waves { opacity: .85; }
  .seal-plaque {
    display: flex; align-items: center; gap: 9px;
    border: 2.4px solid var(--seal-ink); border-radius: 10px;
    padding: 6px 12px; color: var(--seal-ink);
    font-weight: 700; font-size: 13.5px; letter-spacing: .03em;
  }
  .plaque__cell { display: inline-flex; align-items: center; gap: 6px; unicode-bidi: isolate; direction: ltr; white-space: nowrap; }
  .plaque__cell svg { opacity: .9; }
  .plaque__div { width: 1.6px; height: 18px; background: var(--seal-ink); opacity: .85; }
  /* ---------- certificate + body ---------- */
  .cert { margin: 6px 0 16px; border-block: 1px solid var(--line); padding: 9px 2px; display: grid; gap: 4px; }
  .cert__row { display: flex; gap: 10px; font-size: 12.4px; align-items: baseline; }
  .cert__k { flex: none; min-width: 74px; font-weight: 800; color: var(--ink-soft); font-size: 10.8px; letter-spacing: .02em; }
  .cert__v { font-weight: 650; word-break: break-word; unicode-bidi: plaintext; }
  .auth-list { display: flex; flex-wrap: wrap; gap: 5px; }
  .auth-chip {
    display: inline-flex; padding: 1px 9px; border-radius: 999px; font-size: 10.6px; font-weight: 800;
    letter-spacing: .03em; border: 1.2px solid;
  }
  .auth-chip.is-pass { color: #1c5c34; border-color: #1c5c34; background: rgba(28,92,52,.06); }
  .auth-chip.is-warn { color: #8a5a12; border-color: #8a5a12; background: rgba(138,90,18,.07); }
  .att-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .att-chip { display: inline-flex; gap: 6px; align-items: baseline; background: #f1efe7; border: 1px solid var(--line-soft); border-radius: 7px; padding: 2px 9px; font-size: 11px; }
  .att-chip i { font-style: normal; color: var(--ink-soft); font-size: 10px; }
  .note-block { margin: 0 0 14px; border-inline-start: 3px solid var(--line); background: #f3f0e6; border-radius: 8px; padding: 8px 13px; }
  .note-block__k { font-size: 10.4px; font-weight: 800; color: var(--ink-soft); letter-spacing: .04em; display: block; margin-bottom: 2px; }
  .note-block p { margin: 0; font-size: 12.6px; }
  .subject { font-size: 21px; font-weight: 800; line-height: 1.5; margin: 2px 0 4px; }
  .subject-rule { width: 64px; border: 0; border-top: 3px solid var(--ink); margin: 6px 0 18px; }
  /* the seal column is sacred: the head of the document never runs under it */
  .subject, .cert, .note-block { margin-inline-end: 48mm; }
  .letter-body { text-align: start; overflow-wrap: break-word; unicode-bidi: plaintext; }
  .letter-body--plain { white-space: pre-wrap; font-size: 13.4px; }
  .letter-body img { max-width: 100%; height: auto; border-radius: 6px; }
  .letter-body a { color: #0a1294; }
  .letter-body blockquote { margin: 12px 0; padding: 4px 14px; border-inline-start: 3px solid var(--line); color: var(--ink-soft); }
  .letter-body pre, .letter-body code { font-family: ui-monospace, monospace; font-size: 11.5px; background: #f1efe7; border-radius: 5px; }
  .letter-body pre { padding: 10px 12px; overflow-x: auto; }
  .letter-body code { padding: 1px 5px; }
  .letter-body table { max-width: 100%; border-collapse: collapse; }
  /* ---------- footer ---------- */
  .paper-foot {
    position: absolute; inset-inline: 12mm; bottom: 12mm;
    display: flex; justify-content: space-between; align-items: center;
    border-top: 1px solid var(--line); padding-top: 7px;
    font-size: 9.6px; color: var(--ink-soft); letter-spacing: .04em;
  }
  .paper-foot b { font-weight: 800; color: var(--ink); }
  .paper-foot .seal-line { display: inline-flex; align-items: center; gap: 7px; }
  .paper-foot .seal-line .dot { width: 5px; height: 5px; border-radius: 999px; background: var(--seal-ink); opacity: .75; }
  /* ---------- print ---------- */
  @media print {
    body { background: var(--paper); }
    .paper { box-shadow: none; width: auto; min-height: auto; margin: 0; }
  }
</style>
</head>
<body>
  <div class="paper">
    <img class="watermark" src="${MARK_SRC}" alt=""/>
    <div class="seal-corner">
      <img class="seal-img" src="${SEAL_SRC}" alt=""/>
      ${wavesSvg()}
      ${plaqueHtml(now)}
    </div>
    <div class="lh">
      ${mark}
      <div class="lh-txt">
        <div class="lh-name">Cmail</div>
        <div class="lh-sub">${dir === 'rtl' ? 'نامهٔ رسمی' : 'Official letter'}</div>
      </div>
    </div>
    <div class="lh-rule"></div>
    <h1 class="subject">${esc(em.subject || '')}</h1>
    <hr class="subject-rule">
    ${cert}
    ${bodyHtml}
    <div class="paper-foot">
      <span>${t('printPaperFoot')}</span>
      <span class="seal-line"><span class="dot"></span>${esc(t('printStampedAt'))} <b>${stampAt}</b><span class="dot"></span><b>Cmail</b></span>
    </div>
  </div>
</body>
</html>`;
}

// ---------- the one press: fetch the full paperwork, build, wait, print ----------
export async function openPrint(em, atts = null) {
  // the context menu hands over the LIST row — the certificate deserves the
  // full truth: headers, attachments, the note. One quiet GET, then print.
  let full = em, list = Array.isArray(atts) ? atts : null, note = null, headers = [];
  try {
    const r = await api.get(`/api/emails/${em.id}`);
    if (r?.ok && r.email) {
      full = r.email;
      list = r.attachments ?? list;
      note = r.note ?? null;
      headers = Array.isArray(r.headers) ? r.headers : [];
    }
  } catch { /* the row's own data still prints */ }
  const logo = await getPrintLogo();
  const html = buildPrintDoc(full, list, note, logo, headers);

  const old = document.getElementById('cmail-print-frame');
  if (old) old.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'cmail-print-frame';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;inset-inline-start:-9999px;top:0;width:820px;height:1120px;border:0;visibility:hidden;';
  iframe.setAttribute('srcdoc', html);
  document.body.append(iframe);

  iframe.addEventListener('load', () => {
    const w = iframe.contentWindow;
    if (!w) return;
    const imgs = [...w.document.images].map((img) => img.complete
      ? Promise.resolve()
      : new Promise((res) => { img.onload = img.onerror = res; }));
    Promise.all([w.document.fonts?.ready ?? Promise.resolve(), ...imgs])
      .then(() => setTimeout(() => {
        try { w.focus(); w.print(); } catch { /* the dialog refuses — the frame simply stays */ }
        setTimeout(() => iframe.remove(), 1500);
      }, 180));
  }, { once: true });
}
