// Cmail — shared email-text machinery: sanitize, direction, frame CSS.
// One home for the letter-rendering primitives the reader (mail view) and
// the print studio both need — no duplicated sanitizer that can drift.
// v3.2.0: extracted verbatim from views/mail.js.

/* ---------- HTML email sanitizing & rendering ---------- */

// strip scripts / event handlers / dangerous urls — keep full visual structure.
// v3.1.0: meta-refresh joins the ban list (a letter must not be able to swap
// its own frame for an external page), and the rendered frame carries its own
// strict CSP so even a future sanitizer gap can never run script inside it.
export function sanitizeEmailHtml(raw) {
  const doc = new DOMParser().parseFromString(String(raw ?? ''), 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, link[rel="import"], base, form, input, button, textarea, select, meta[http-equiv="refresh"], meta[charset]').forEach((n) => n.remove());
  for (const el of [...doc.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const val = String(attr.value ?? '');
      if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
      if (name === 'http-equiv' || name === 'content' && el.tagName === 'META') { el.removeAttribute(attr.name); continue; }
      if (['href', 'src', 'srcset', 'xlink:href', 'action', 'formaction', 'background', 'poster'].includes(name)
        && /^\s*(javascript|vbscript|data\s*:\s*text\/html)/i.test(val)) { el.removeAttribute(attr.name); continue; }
      if (name === 'style' && /expression\s*\(|javascript\s*:/i.test(val)) el.removeAttribute(attr.name);
    }
  }
  // the email's own CSP metas cannot survive (a META with content but no
  // http-equiv is noise) — ours is the only policy the frame ever sees
  doc.querySelectorAll('meta').forEach((n) => n.remove());
  return doc;
}

// the frame's own policy — injected AFTER sanitization so the email cannot
// influence it: no script, no objects, no forms, no frames, images/styles
// still render exactly like a letter should
export const MAIL_FRAME_CSP = "default-src 'none'; img-src data: blob: https: http:; style-src 'unsafe-inline' https: http: data:; font-src data: https: http:; media-src data: blob: https: http:; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none';";

export function detectDir(doc) {
  const html = doc.documentElement;
  const langAttr = (html.getAttribute('lang') || doc.body?.getAttribute('dir') || html.getAttribute('dir') || '').toLowerCase();
  if (html.getAttribute('dir') === 'rtl' || langAttr.startsWith('fa') || langAttr.startsWith('ar') || langAttr.startsWith('he')) return 'rtl';
  const text = (doc.body?.textContent || '').slice(0, 800);
  const rtlChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  return rtlChars > text.length * 0.25 ? 'rtl' : 'ltr';
}

// the base stylesheet injected into every rendered email
export function mailFrameCss() {
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
