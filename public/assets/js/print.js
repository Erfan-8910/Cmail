// Cmail — print studio (v3.2.0): the letter on paper, ready for PDF.
// One press on “Print / PDF” builds a complete standalone document inside a
// hidden iframe — textured paper, a letterhead that carries the maker's own
// mark, and the official round stamp with the device's exact date and time.
// Everything lives in the iframe's own <style>, so the app's glass UI can
// never leak into the page and the print dialog sees a pure paper world.
import { api } from './api.js';
import { t, lang } from './i18n.js';
import { sanitizeEmailHtml, detectDir } from './mailtext.js';

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

// ---------- small svg drawing helpers for the stamp ----------
// a tiny seeded PRNG — the rubber-stamp wear must look identical on every
// page and every machine, so no Math.random here
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function starPts(cx, cy, rOut, rIn) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

// one laurel branch: a stem arc hugging the ring with paired leaves riding
// it, tip toward the top — the two branches frame the mark like the sample.
// Screen angle convention: 0° = right, 90° = down, 270° = top.
function laurel(mirror) {
  const CX = 110, CY = 95, R = 62, N = 7;
  // right branch: from just below the right horizontal, up to near the top;
  // left branch: the mirrored sweep through the left side
  const a0 = mirror ? 168 : 12;
  const a1 = mirror ? 276 : -96;
  const sweep = mirror ? 1 : 0;
  const P = (a) => [CX + R * Math.cos((a * Math.PI) / 180), CY + R * Math.sin((a * Math.PI) / 180)];
  const out = [];
  const [x0, y0] = P(a0), [x1, y1] = P(a1);
  out.push(`<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 0 ${sweep} ${x1.toFixed(1)} ${y1.toFixed(1)}"
    fill="none" stroke="var(--stamp-ink)" stroke-width="1.6"/>`);
  for (let i = 0; i < N; i++) {
    const p = i / (N - 1);
    const a = a0 + (a1 - a0) * p;
    const rad = (a * Math.PI) / 180;
    const grow = Math.sin(Math.PI * (0.12 + 0.88 * p));
    for (const side of [-1, 1]) {
      const lr = R + side * (5 + 1.6 * grow);
      const lx = CX + lr * Math.cos(rad), ly = CY + lr * Math.sin(rad);
      // the leaf lies along the arc's tangent, angled outward from the stem
      const tang = a + (mirror ? 90 : -90) + side * 36;
      out.push(`<ellipse cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" rx="${(7.4 * grow + 2.6).toFixed(1)}" ry="${(2.8 * grow + 1.1).toFixed(1)}"
        transform="rotate(${tang.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})"/>`);
    }
  }
  return `<g fill="var(--stamp-ink)">${out.join('')}</g>`;
}

// the rubber-stamp wear: seeded paper-colored dots and scratches punched over
// the ink — deterministic, prints identically everywhere, no filter needed
function wear() {
  const rnd = mulberry32(20261126);
  const dots = [];
  for (let i = 0; i < 210; i++) {
    const x = rnd() * 220, y = rnd() * 235;
    const r = 0.4 + rnd() * rnd() * 1.9;
    dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="var(--paper-ink)"/>`);
  }
  const scr = [];
  for (let i = 0; i < 16; i++) {
    const x = rnd() * 200 + 10, y = rnd() * 220 + 8;
    const len = 3 + rnd() * 11, a = rnd() * Math.PI;
    scr.push(`<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + len * Math.cos(a)).toFixed(1)}" y2="${(y + len * Math.sin(a)).toFixed(1)}"
      stroke="var(--paper-ink)" stroke-width="${(0.5 + rnd()).toFixed(2)}"/>`);
  }
  return dots.join('') + scr.join('');
}

// the round official stamp — the whole ceremony in one svg:
// double ring · star arc · laurel pair · the mark · the name plate ·
// and the plaque that carries the device's exact date and time
function stampSvg(logoDataUrl, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const CX = 110, CY = 95;
  const stars = [-58, -35, -12, 11, 34].map((deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    const cx = (CX + 50 * Math.cos(rad)).toFixed(1);
    const cy = (CY + 50 * Math.sin(rad)).toFixed(1);
    return `<polygon points="${starPts(+cx, +cy, 6.4, 2.7)}" fill="var(--stamp-ink)"/>`;
  }).join('');

  const mark = logoDataUrl
    ? `<clipPath id="markClip"><circle cx="${CX}" cy="76" r="29"/></clipPath>
       <image href="${logoDataUrl}" x="${CX - 29}" y="47" width="58" height="58" preserveAspectRatio="xMidYMid slice" clip-path="url(#markClip)"/>`
    // the fallback: Cmail's own mark, drawn — a ring with a gap holding an envelope
    : `<g stroke="var(--stamp-ink)" fill="none" transform="translate(4 -12)">
         <circle cx="${CX}" cy="88" r="26.5" stroke-width="8.5"
           stroke-dasharray="128 38" stroke-dashoffset="26" stroke-linecap="round"/>
         <rect x="${CX - 11}" y="83" width="22" height="15" rx="3.5" stroke-width="2.8"/>
         <path d="M${CX - 10.2} 84.6l10.2 8 10.2-8" stroke-width="2.6" stroke-linejoin="round"/>
       </g>`;

  return `
  <svg class="stamp" viewBox="0 0 220 246" width="152" height="170" aria-hidden="true">
    <g>
      <circle cx="${CX}" cy="${CY}" r="88" fill="none" stroke="var(--stamp-ink)" stroke-width="3.6"/>
      <circle cx="${CX}" cy="${CY}" r="71" fill="none" stroke="var(--stamp-ink)" stroke-width="1.5"/>
      ${stars}
      ${laurel(false)}
      ${laurel(true)}
      ${mark}
      <text x="${CX}" y="128" text-anchor="middle" font-size="23" font-weight="800"
        letter-spacing="1.2" fill="var(--stamp-ink)" font-family="'Vazirmatn','Segoe UI',sans-serif">Cmail</text>
      <g fill="var(--stamp-ink)">
        <rect x="42" y="133" width="22" height="2.2" rx="1.1"/>
        <rect x="156" y="133" width="22" height="2.2" rx="1.1"/>
      </g>
      <text x="${CX}" y="143.5" text-anchor="middle" font-size="11" font-weight="700"
        letter-spacing="4.2" fill="var(--stamp-ink)" font-family="'Segoe UI',Arial,sans-serif">OFFICIAL</text>
      <g fill="var(--stamp-ink)">
        <polygon points="${starPts(80, 154, 4.8, 2)}"/>
        <polygon points="${starPts(110, 154, 5.6, 2.4)}"/>
        <polygon points="${starPts(140, 154, 4.8, 2)}"/>
      </g>
      <!-- the plaque: calendar · date | clock · time — the device's own truth -->
      <g>
        <rect x="14" y="196" width="192" height="37" rx="9" fill="none" stroke="var(--stamp-ink)" stroke-width="2.6"/>
        <g stroke="var(--stamp-ink)" stroke-width="2.2" fill="none">
          <rect x="26" y="205.5" width="15" height="14" rx="2.5"/>
          <path d="M26 210.5h15M30.5 203.5v3.4M36.5 203.5v3.4"/>
          <circle cx="141.5" cy="212" r="7.5"/>
          <path d="M141.5 208v4l3 2"/>
        </g>
        <text x="48" y="219" font-size="13.5" font-weight="700" fill="var(--stamp-ink)"
          font-family="'Segoe UI',Arial,sans-serif" letter-spacing=".4">${dateStr}</text>
        <path d="M105 203.5v22" stroke="var(--stamp-ink)" stroke-width="2.2"/>
        <text x="153.5" y="219" font-size="13.5" font-weight="700" fill="var(--stamp-ink)"
          font-family="'Segoe UI',Arial,sans-serif" letter-spacing=".4">${timeStr}</text>
      </g>
      ${wear()}
    </g>
  </svg>`;
}

// the wavy cancellation lines the postman drags across the stamp corner
function wavesSvg() {
  const wave = (y) => `M0 ${y} q 14 -7 28 0 t 28 0 t 28 0 t 28 0 t 28 0 t 28 0 t 28 0`;
  return `<svg class="stamp-waves" viewBox="0 0 168 66" width="150" height="59" aria-hidden="true">
    <g fill="none" stroke="var(--stamp-ink)" stroke-width="2.4" stroke-linecap="round" opacity=".8">
      <path d="${wave(8)}"/><path d="${wave(24)}"/><path d="${wave(40)}"/><path d="${wave(56)}"/>
    </g>
  </svg>`;
}

// the letterhead mark: the uploaded image when there is one — otherwise the
// drawn Cmail mark with the name beside it
function letterheadMark(logo) {
  if (logo) return `<img class="lh-logo" src="${logo}" alt=""/>`;
  return `<span class="lh-mark" aria-hidden="true">
    <svg viewBox="0 0 40 40" width="30" height="30">
      <g stroke="#20261f" fill="none">
        <circle cx="20" cy="20" r="14.5" stroke-width="5"
          stroke-dasharray="71 20" stroke-dashoffset="11" stroke-linecap="round"/>
        <rect x="13.5" y="16.5" width="13" height="9" rx="2" stroke-width="1.6"/>
        <path d="M14 17.6l6 4.4 6-4.4" stroke-width="1.5" stroke-linejoin="round"/>
      </g>
    </svg></span>`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

// ---------- the document ----------
function buildPrintDoc(em, atts, logo) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const sentDate = em.received_at
    ? `${new Date(em.received_at).getFullYear()}-${pad(new Date(em.received_at).getMonth() + 1)}-${pad(new Date(em.received_at).getDate())} · ${pad(new Date(em.received_at).getHours())}:${pad(new Date(em.received_at).getMinutes())}`
    : '';
  const dir = em.html_body ? detectDir(sanitizeEmailHtml(em.html_body)) : (/[\u0600-\u06FF]/.test(em.text_body || '') ? 'rtl' : 'ltr');

  // body: rendered text for plain letters; sanitized html for rich ones
  let bodyHtml = '';
  if (em.html_body) {
    const doc = sanitizeEmailHtml(em.html_body);
    bodyHtml = `<div class="letter-body">${doc.body.innerHTML}</div>`;
  } else {
    bodyHtml = `<div class="letter-body letter-body--plain">${esc(em.text_body || t('printNoBody'))}</div>`;
  }

  const attRow = atts?.length
    ? `<div class="letter-atts">${atts.map((a) => `<span>${esc(a.filename || 'file')}</span>`).join('')}</div>`
    : '';

  const stampSide = dir === 'rtl' ? 'left' : 'right';
  const FA = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
  const dateOut = lang === 'fa' ? FA(sentDate) : sentDate;

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
    --paper: #f9f7f1; --stamp-ink: #2b46a8; --paper-ink: #f9f7f1;
  }
  * { box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body { background: #ecebe6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .paper {
    position: relative; width: 210mm; min-height: 297mm; margin: 0 auto;
    background: var(--paper); color: var(--ink);
    ${'' /* paper texture painted as layers, not flat color */}
    box-shadow: 0 2px 18px rgba(40,36,24,.14);
    padding: 17mm 16mm 20mm;
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
  /* ---------- letterhead ---------- */
  .lh { position: relative; display: flex; align-items: center; gap: 12px; padding-bottom: 12px; }
  .lh-logo { width: 46px; height: 46px; object-fit: contain; border-radius: 12px; }
  .lh-mark { display: grid; place-items: center; width: 46px; height: 46px; }
  .lh-name { font-size: 21px; font-weight: 800; letter-spacing: -.2px; }
  .lh-sub { font-size: 10.5px; color: var(--ink-soft); letter-spacing: .12em; text-transform: uppercase; }
  .lh-rule {
    height: 0; border-top: 2px solid var(--ink); border-bottom: 1px solid var(--line);
    margin: 0 0 14px; position: relative;
  }
  /* ---------- the stamp corner ---------- */
  .stamp-corner {
    position: absolute; top: 6mm; ${stampSide}: 8mm; width: 158px;
    display: flex; align-items: flex-start; gap: 0;
    transform: rotate(${dir === 'rtl' ? '7' : '-7'}deg);
  }
  .stamp-corner .stamp { flex: none; opacity: .94; }
  .stamp-waves { margin-top: 12px; margin-${dir === 'rtl' ? 'right' : 'left'}: -34px; flex: none; }
  /* ---------- meta + body ---------- */
  .meta { margin: 4px 0 14px; display: grid; gap: 3px; max-width: 55%; min-height: 88px; align-content: start; }
  .meta__row { display: flex; gap: 8px; font-size: 12.6px; }
  .meta__k { flex: none; min-width: 64px; font-weight: 800; color: var(--ink-soft); font-size: 11px; padding-top: 1px; }
  .meta__v { font-weight: 650; word-break: break-all; unicode-bidi: plaintext; }
  .subject { font-size: 21px; font-weight: 800; line-height: 1.5; margin: 0 0 4px; }
  .subject-rule { width: 64px; border: 0; border-top: 3px solid var(--ink); margin: 6px 0 18px; }
  .letter-body { text-align: start; overflow-wrap: break-word; }
  .letter-body--plain { white-space: pre-wrap; font-size: 13.4px; }
  .letter-body img { max-width: 100%; height: auto; border-radius: 6px; }
  .letter-body a { color: #2b46a8; }
  .letter-body blockquote { margin: 12px 0; padding: 4px 14px; border-inline-start: 3px solid var(--line); color: var(--ink-soft); }
  .letter-body pre, .letter-body code { font-family: ui-monospace, monospace; font-size: 11.5px; background: #f1efe7; border-radius: 5px; }
  .letter-body pre { padding: 10px 12px; overflow-x: auto; }
  .letter-body code { padding: 1px 5px; }
  .letter-body table { max-width: 100%; border-collapse: collapse; }
  .letter-atts { margin-top: 22px; padding-top: 10px; border-top: 1px dashed var(--line); display: flex; flex-wrap: wrap; gap: 6px; font-size: 11px; color: var(--ink-soft); }
  .letter-atts span::before { content: '⌁ '; color: var(--stamp-ink); }
  .letter-atts span { background: #f1efe7; border: 1px solid var(--line-soft); border-radius: 7px; padding: 2px 9px; }
  /* ---------- footer ---------- */
  .paper-foot {
    position: absolute; inset-inline: 16mm; bottom: 11mm;
    display: flex; justify-content: space-between; align-items: center;
    border-top: 1px solid var(--line); padding-top: 7px;
    font-size: 9.8px; color: var(--ink-soft); letter-spacing: .04em;
  }
  .paper-foot b { font-weight: 800; color: var(--ink); }
  /* ---------- print ---------- */
  @media print {
    body { background: var(--paper); }
    .paper { box-shadow: none; width: auto; min-height: auto; margin: 0; }
  }
</style>
</head>
<body>
  <div class="paper">
    <div class="stamp-corner">${stampSvg(logo, now)}${wavesSvg()}</div>
    <div class="lh">
      ${letterheadMark(logo)}
      <div class="lh-txt">
        <div class="lh-name">Cmail</div>
        <div class="lh-sub">${dir === 'rtl' ? 'نامهٔ رسمی' : 'Official letter'}</div>
      </div>
    </div>
    <div class="lh-rule"></div>
    <div class="meta">
      <div class="meta__row"><span class="meta__k">${t('printStampOf')}</span><span class="meta__v">${esc(em.direction === 'out' ? (em.from_addr || '') : (em.from_name ? `${em.from_name} · ${em.from_addr}` : em.from_addr))}</span></div>
      <div class="meta__row"><span class="meta__k">${t('printStampTo')}</span><span class="meta__v">${esc(em.to_addr || '')}</span></div>
      <div class="meta__row"><span class="meta__k">${t('printStampDate')}</span><span class="meta__v">${esc(dateOut)}</span></div>
    </div>
    <h1 class="subject">${esc(em.subject || '')}</h1>
    <hr class="subject-rule">
    ${bodyHtml}
    ${attRow}
    <div class="paper-foot">
      <span>${t('printPaperFoot')}</span>
      <b>Cmail</b>
    </div>
  </div>
</body>
</html>`;
}

// ---------- the one press: build, wait, print ----------
export async function openPrint(em, atts = null) {
  const logo = await getPrintLogo();
  const html = buildPrintDoc(em, atts, logo);

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
