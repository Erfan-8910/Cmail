// Cmail — the lock screen.
//
// v3.1.1: the padlock is the SERVER's fact, not a browser flag. Locking asks
// the worker to stamp THIS session's row (sessions.locked_at), and from that
// moment the worker itself refuses every data endpoint for the session —
// mail, vault, attachments, send, everything — with 403 session_locked.
//
// The overlay you see is only the honest painting of a state the server
// owns. Deleting it with the inspector reveals nothing: the panel behind it
// is WIPED the moment the lock lands (the cmail:wipe-private event clears
// the app root, the dialogs, the account cache), and every API the shell
// could still call answers 403 — which re-draws this overlay instantly.
// Clearing sessionStorage changes nothing: the server re-locks on the next
// /me answer or the next data call, whichever comes first.
//
// The ways back in are the credential the owner chose (the second factor by
// default, or the panel password — Settings → Security) or signing out
// entirely. Both go through the worker.
import { api, state, errText } from './api.js';
import { t } from './i18n.js';
import { h, clear, icon, toast, vibrate } from './ui.js';

const KEY = 'cmail_locked'; // cosmetic hint only — the server row is the truth
let overlayEl = null;

// locked as far as anyone can see: the server said so (state.sessionLocked,
// set from /me or a 403 session_locked) or the tab carries the local hint
export function isLocked() {
  return state.sessionLocked === true || sessionStorage.getItem(KEY) === '1';
}

// the panel goes dark behind the overlay: nothing sensitive stays in the DOM
// to be found by deleting the cover. app.js owns those surfaces — it wipes
// them when it hears this event (no circular import, one direction of truth)
function wipeBehind() {
  try { window.dispatchEvent(new CustomEvent('cmail:wipe-private')); } catch { /* */ }
}

// ask the worker to lock the session — the lock lands in D1 or not at all.
// A failed call never fakes a lock: the user hears it and the panel stays.
export async function lockNow() {
  try {
    await api.post('/api/auth/lock', {});
  } catch (err) {
    toast(errText(err), 'err');
    return;
  }
  sessionStorage.setItem(KEY, '1');
  state.sessionLocked = true;
  wipeBehind();
  render();
}

// the server said "this session is locked" (a 403 session_locked from any
// call, or /me answering session_locked) — paint the lock over a wiped panel
export function forceLockUI() {
  if (overlayEl) return;
  sessionStorage.setItem(KEY, '1');
  state.sessionLocked = true;
  wipeBehind();
  render();
}

// called on boot and on every navigation — a locked tab stays locked (the
// server's flag, then the local hint), a guest session never sees the lock
// at all, and an unlocked session puts the overlay away
export function maybeLock() {
  if (isLocked() && state.user && state.user.role !== 'share') {
    if (!overlayEl) { wipeBehind(); render(); }
  } else if (overlayEl) {
    unlockDone();
  }
}

// what the lock asks for — the owner's choice, read from /me
function mode() { return state.lockMode === 'password' ? 'password' : 'totp'; }

function render() {
  if (overlayEl) return; // already on stage
  const m = mode();

  const title = h('h2', { class: 'lock__title' }, t('lockTitle'));
  const sub = h('p', { class: 'lock__sub' }, m === 'password' ? t('lockSubPw') : t('lockSubTotp'));

  const input = h('input', {
    class: `input ${m === 'totp' ? 'mono' : ''}`,
    type: m === 'password' ? 'password' : 'text',
    inputmode: m === 'totp' ? 'numeric' : undefined,
    autocomplete: m === 'totp' ? 'one-time-code' : 'current-password',
    maxlength: m === 'totp' ? '8' : undefined,
    placeholder: m === 'totp' ? '••••••' : '••••••••',
    style: { textAlign: 'center', fontSize: m === 'totp' ? '20px' : '16px', letterSpacing: m === 'totp' ? '7px' : '2px' },
    'aria-label': m === 'password' ? t('password') : t('totpTitle'),
  });

  const btn = h('button', { class: 'btn btn--primary', type: 'submit', style: { width: '100%' } }, icon('lock'), t('lockUnlock'));
  const out = h('button', { class: 'btn btn--ghost', type: 'button', style: { width: '100%' } }, icon('logout'), t('lockLogout'));
  const card = h('div', { class: 'lock__card glass' },
    h('span', { class: 'lock__sigil', 'aria-hidden': 'true' }, icon('lockMode')),
    title, sub,
    h('form', { class: 'auth-form' }, h('div', { class: 'field' }, input), btn, out));
  overlayEl = h('div', { class: 'lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('lockTitle') }, card);
  requestAnimationFrame(() => overlayEl?.classList.add('is-on'));
  document.body.append(overlayEl);

  // pointer devices get the field focused immediately; phones wait a beat so
  // the keyboard does not yank the overlay up mid-animation
  const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  setTimeout(() => input.focus(), fine ? 80 : 350);

  const shake = () => {
    vibrate([12, 50, 12]);
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
    setTimeout(() => card.classList.remove('shake'), 600);
  };

  out.addEventListener('click', async () => {
    await api.post('/api/auth/logout').catch(() => { });
    sessionStorage.removeItem(KEY);
    state.sessionLocked = false;
    unlockDone();
    state.user = null;
    location.hash = '#/login';
    if ((location.hash || '') === '#/login') location.reload();
  });

  card.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = String(input.value ?? '').trim();
    if (!value) { shake(); return; }
    btn.disabled = true;
    try {
      // the credential check lives on the worker; only ITS yes opens the
      // session row (locked_at = 0) — the panel repaints from that answer
      await api.post('/api/auth/verify-unlock', m === 'password' ? { mode: 'password', password: value } : { mode: 'totp', code: value });
      toast(t('lockWelcome'), 'ok', 1600);
      sessionStorage.removeItem(KEY);
      state.sessionLocked = false;
      unlockDone();
      // the wiped panel comes back fresh: one clean re-render of the page
      window.dispatchEvent(new Event('cmail:rerender'));
    } catch (err) {
      toast(errText(err), 'err');
      shake();
      input.value = '';
      btn.disabled = false;
      // the second factor was switched off (or the mode changed) while the
      // panel sat locked — fall back to the panel password honestly
      if (err?.code === 'totp_not_enabled') {
        state.lockMode = 'password';
        overlayEl?.remove();
        overlayEl = null;
        render();
      }
      return;
    }
    btn.disabled = false;
  });
}

function unlockDone() {
  sessionStorage.removeItem(KEY);
  state.sessionLocked = false;
  const el = overlayEl;
  overlayEl = null;
  if (el) {
    el.classList.remove('is-on');
    setTimeout(() => el.remove(), 320);
  }
}
