// Cmail — outgoing email via HTTP providers (Brevo / Resend)
import type { Env } from './util';
import { getSettings, openText } from './util';

export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

// v3.1.5 — the provider call gets a hard ceiling: a hanging HTTP connection
// used to pin the composer's spinner forever. 20s and the attempt is over,
// with an honest error instead of an eternal "sending…".
const PROVIDER_TIMEOUT_MS = 20_000;

// plain text still deserves a real letter shape — a styled block that wraps
// and breathes, not a bare <pre> strip (v3.1.5)
function textToHtml(text: string): string {
  return `<div style="font:14px/1.85 -apple-system,'Segoe UI',Tahoma,sans-serif;color:#1f2937;white-space:pre-wrap;max-width:640px">${escapeHtml(text)}</div>`;
}

// since v3.1.0 the provider key is stored SEALED (AES-GCM). Legacy plaintext
// values keep working — and get sealed on the next settings save.
async function sendingKey(env: Env, stored: string): Promise<string> {
  if (!stored) return '';
  if (stored.startsWith('v1.')) {
    try { return await openText(env, stored); } catch { return ''; }
  }
  return stored;
}

export async function sendViaProvider(
  env: Env,
  opts: { to: string; toName?: string; subject: string; text: string; html?: string; replyTo?: string;
          attachments?: { filename: string; content_type: string; content_b64: string }[] }
): Promise<SendResult> {
  const cfg = await getSettings(env, ['sending_provider', 'sending_api_key', 'sending_from_email', 'sending_from_name']);
  const provider = cfg.sending_provider ?? 'none';
  const apiKey = await sendingKey(env, cfg.sending_api_key ?? '');
  const fromEmail = cfg.sending_from_email ?? '';
  const fromName = cfg.sending_from_name ?? 'Cmail';

  if (provider === 'none') return { ok: false, error: 'sending_not_configured' };
  if (!apiKey || !fromEmail) return { ok: false, error: 'sending_not_configured' };

  // v3.2.0 — attachments ride along: base64 payloads accepted by both
  // provider APIs (Brevo: attachment[{name,content}], Resend:
  // attachments[{filename,content}]). The stored copy in D1 keeps the
  // original content-type so the reader's download row stays honest.
  const atts = (opts.attachments ?? []).filter((a) => a && a.content_b64).slice(0, 4);

  try {
    if (provider === 'brevo') {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: fromEmail, name: fromName },
          to: [{ email: opts.to, name: opts.toName ?? opts.to }],
          subject: opts.subject,
          textContent: opts.text,
          htmlContent: opts.html || textToHtml(opts.text),
          replyTo: opts.replyTo ? { email: opts.replyTo } : undefined,
          attachment: atts.length ? atts.map((a) => ({ name: a.filename, content: a.content_b64 })) : undefined,
        }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { ok: false, error: `brevo_${res.status}: ${body.slice(0, 300)}` };
      }
      const data = await res.json<{ messageId?: string }>();
      return { ok: true, id: data.messageId };
    }

    if (provider === 'resend') {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
          to: [opts.to],
          subject: opts.subject,
          text: opts.text,
          html: opts.html || textToHtml(opts.text),
          reply_to: opts.replyTo,
          attachments: atts.length ? atts.map((a) => ({ filename: a.filename, content: a.content_b64 })) : undefined,
        }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { ok: false, error: `resend_${res.status}: ${body.slice(0, 300)}` };
      }
      const data = await res.json<{ id?: string }>();
      return { ok: true, id: data.id };
    }

    return { ok: false, error: 'unknown_provider' };
  } catch (e) {
    return { ok: false, error: `network: ${(e as Error).message.slice(0, 200)}` };
  }
}

export async function testProvider(env: Env, to: string): Promise<SendResult> {
  return sendViaProvider(env, {
    to,
    subject: '✉️ Cmail — test message',
    text: 'This is a test message from your Cmail instance. If you received it, outgoing mail works!',
    html: '<div style="font:15px/1.7 sans-serif">This is a <b>test message</b> from your Cmail instance.<br>If you received it, outgoing mail works! ✉️</div>',
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
