// Cmail — update check: the installed build vs the newest GitHub release.
// The worker asks GitHub (the browser's CSP stays same-origin), caches the
// answer for ten minutes per isolate, and compares plain semver — nothing
// fancier than the version the project actually publishes.
import type { Env } from './util';

const REPO = 'Erfan-8910/Cmail';
const TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 8_000;

type Latest = { version: string; url: string; name: string; published_at: string };
type CheckResult = {
  ok: boolean;
  current: string;
  latest?: string;
  update_available: boolean;
  url?: string;
  name?: string;
  published_at?: string;
};

let cache: { at: number; data: Latest | null } = { at: 0, data: null };

const semver = (s: string): [number, number, number] | null => {
  const m = String(s ?? '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

export function isNewer(current: string, candidate: string): boolean {
  const a = semver(current), b = semver(candidate);
  if (!a || !b) return false;
  return b[0] > a[0] || (b[0] === a[0] && (b[1] > a[1] || (b[1] === a[1] && b[2] > a[2])));
}

async function fetchLatest(): Promise<Latest | null> {
  // 1) the REST API — rich fields (release name, publish date), but it is
  // rate-limited per IP and Cloudflare's shared egress IPs feel that often
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'cmail-update-check' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      const j = await res.json<{ tag_name?: string; name?: string; html_url?: string; published_at?: string; draft?: boolean; prerelease?: boolean }>();
      if (!j.draft && !j.prerelease && j.tag_name) {
        return {
          version: String(j.tag_name),
          url: j.html_url || `https://github.com/${REPO}/releases`,
          name: j.name || '',
          published_at: j.published_at || '',
        };
      }
    }
  } catch { /* fall through to the redirect */ }

  // 2) the releases/latest page itself: GitHub answers with a plain 302 to
  // /releases/tag/vX.Y.Z — no API quota involved, works every time
  const res = await fetch(`https://github.com/${REPO}/releases/latest`, {
    redirect: 'manual',
    headers: { 'user-agent': 'cmail-update-check' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const loc = res.headers.get('location') ?? '';
  const m = loc.match(/\/tag\/(v?\d+\.\d+\.\d+)/i);
  if (m) {
    return { version: m[1], url: `https://github.com/${REPO}/releases/tag/${m[1]}`, name: '', published_at: '' };
  }
  throw new Error('github_unreachable');
}

export async function updateCheck(current: string, force = false): Promise<CheckResult> {
  const out = (latest: Latest | null): CheckResult => ({
    ok: true,
    current,
    ...(latest ? {
      latest: latest.version,
      update_available: isNewer(current, latest.version),
      url: latest.url,
      name: latest.name,
      published_at: latest.published_at,
    } : { update_available: false }),
  });
  if (!force && cache.data && Date.now() - cache.at < TTL_MS) return out(cache.data);
  try {
    const latest = await fetchLatest();
    cache = { at: Date.now(), data: latest };
    return out(latest);
  } catch {
    // a stale cache is still better than nothing when GitHub is unreachable
    if (cache.data) return out(cache.data);
    return { ok: false, current, update_available: false };
  }
}
