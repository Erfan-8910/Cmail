// Cmail — API client + shared state
import { t } from './i18n.js';

export const state = {
  user: null,
  addresses: [],
  domains: [],
  currentAddressId: null,
  setup: null,
  unread: 0,
};

const BASE = ''; // same-origin

async function request(method, path, body, opts = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  if (res.status === 401 && !path.startsWith('/api/auth') && !path.startsWith('/api/setup')) {
    // session died
    window.dispatchEvent(new CustomEvent('cmail:unauthorized'));
  }
  if (!res.ok || (data && data.ok === false)) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.code = data?.error || 'http_error';
    err.detail = data?.detail;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};

export function errText(e) {
  const map = {
    invalid_credentials: 'invalidCredentials',
    registration_closed: 'registrationClosed',
    username_taken: 'usernameTaken',
    weak_password: 'weakPassword',
    invalid_username: 'invalidUsername',
    address_taken: 'addressTaken',
    invalid_local_part: 'invalidLocal',
    invalid_domain: 'invalidDomain',
    address_limit: 'addrLimit',
    rate_limited: 'rateLimited',
    invalid_secret: 'invalidSecret',
    invalid_uri: 'invalidUri',
    name_required: 'nameRequired',
    sending_not_configured: 'sendingNotConfigured',
    empty_body: 'emptyBody',
    invalid_recipient: 'invalidRecipient',
    invalid_sender: 'invalidSender',
    cannot_delete_self: 'cannotDeleteSelf',
  };
  return map[e?.code] ? t(map[e.code]) : (e?.detail ? `${t('error')} — ${e.detail}` : t('error'));
}
