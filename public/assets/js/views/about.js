// Cmail — About view: the story, the features, the numbers, the maker.
// Liquid-glass polish: count-up numbers, pointer tilt, mood-tinted glow.
// v3.1.5 — the page also tells the truth about the build itself: which
// version is installed on this worker, whether a newer release exists, and
// one press straight into the repository when it does.
import { api, state, errText } from '../api.js';
import { t, lang } from '../i18n.js';
import { h, icon, clear } from '../ui.js';

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ---------- update check: the installed build vs the newest release ----------
// opens with an automatic quiet check; the button re-asks with force=1 and
// the worker's ten-minute cache steps aside. When a newer version exists,
// the card names it and hands the visitor the repo link — no release note
// hunting, no guessing what the install is running.
function updateCard(VERSION) {
  const status = h('div', { class: 'ab-update__st small muted' }, t('updChecking'));
  const btn = h('button', { class: 'btn btn--sm' }, icon('refresh'), t('updCheckBtn'));

  async function check(force) {
    btn.disabled = true;
    btn.classList.add('is-busy');
    status.className = 'ab-update__st small muted';
    status.textContent = t('updChecking');
    try {
      const r = await api.get(`/api/update-check${force ? '?force=1' : ''}`);
      clear(status);
      if (r.ok && r.update_available) {
        status.className = 'ab-update__st ab-update__st--new';
        status.append(
          h('span', { class: 'ab-update__newt' }, icon('spark'), t('updNew').replace('{v}', r.latest ?? '')),
          h('div', { class: 'row mt-1', style: { flexWrap: 'wrap', gap: '8px' } },
            h('a', { class: 'btn btn--sm btn--primary', href: r.url || 'https://github.com/Erfan-8910/CMail/releases', target: '_blank', rel: 'noopener' }, icon('external'), t('updGoRepo')),
            r.name ? h('span', { class: 'small muted', style: { alignSelf: 'center' } }, r.name) : ''),
        );
      } else if (r.ok) {
        // three honest truths: behind (go get it), equal (all good), ahead
        // (the repo has not caught up with this install yet — release window)
        const cmp = (x, y) => {
          const a = String(x).replace(/^v/, '').split('.').map(Number);
          const b = String(y).replace(/^v/, '').split('.').map(Number);
          for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); }
          return 0;
        };
        const ahead = r.latest && r.current && cmp(r.latest, r.current) < 0;
        status.append(icon('check'), h('span', {}, ahead ? t('updAhead').replace('{v}', r.latest) : t('updLatest').replace('{v}', r.latest || VERSION)));
      } else {
        status.append(icon('info'), h('span', {}, t('updFail')));
      }
    } catch (e) {
      status.className = 'ab-update__st small muted';
      clear(status);
      status.append(icon('info'), h('span', {}, errText(e)));
    }
    btn.disabled = false;
    btn.classList.remove('is-busy');
  }

  btn.addEventListener('click', () => check(true));
  const card = h('section', { class: 'ab-update glass' },
    h('div', { class: 'ab-update__head' },
      h('div', { class: 'ab-update__t' }, icon('zap'), h('b', {}, t('updTitle'))),
      h('span', { class: 'chip' }, icon('code'), `${t('updInstalled')} v${VERSION}`),
      btn),
    status);
  check(false);
  return card;
}

export function renderAbout(root) {
  const app = root;
  const FA = (n) => lang === 'fa' ? String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(n);
  const VERSION = state.setup?.version || '3.0.0';

  // ---------- hero ----------
  const hero = h('section', { class: 'ab-hero glass' },
    h('div', { class: 'ab-hero__glow', 'aria-hidden': 'true' }),
    h('img', { class: 'ab-logo', src: 'assets/img/logo-dark.png', alt: 'Cmail' }),
    h('p', { class: 'ab-lead' }, t('aboutLead')),
    h('div', { class: 'ab-hero__meta' },
      h('span', { class: 'chip' }, icon('spark'), `${t('aboutVersion')} ${VERSION}`),
      h('span', { class: 'chip' }, icon('lock'), t('aboutOpen')),
    ),
    h('div', { class: 'ab-hero__links' },
      h('a', { class: 'btn btn--primary', href: 'https://github.com/Erfan-8910/CMail', target: '_blank', rel: 'noopener' }, icon('external'), t('aboutGithub')),
      h('a', { class: 'btn', href: '#/help' }, icon('help'), t('aboutGuide')),
    ),
  );

  // ---------- the sibling-project ribbon: Climind-W ----------
  // a slow aurora band advertising the maker's other project — living,
  // glassy, one press away from the repository. The sky mark reads the sky.
  const ribbon = h('a', {
    class: 'ab-ribbon', href: 'https://github.com/Erfan-8910/Climind-W', target: '_blank', rel: 'noopener',
    'aria-label': t('ribbonClimindCta'),
  },
    h('span', { class: 'ab-ribbon__aurora', 'aria-hidden': 'true' }),
    h('span', { class: 'ab-ribbon__mark', 'aria-hidden': 'true' }, icon('cloud')),
    h('span', { class: 'ab-ribbon__txt' },
      h('b', {}, h('span', { class: 'ab-ribbon__sigil', 'aria-hidden': 'true' }, icon('climind')), 'Climind-W'),
      h('span', { class: 'ab-ribbon__d' }, t('ribbonClimindDesc'))),
    h('span', { class: 'ab-ribbon__chip' }, t('ribbonClimindTag')),
    h('span', { class: 'ab-ribbon__cta' }, t('ribbonClimindCta'), icon('external')),
  );

  // ---------- feature grid (icon beside the title — always aligned) ----------
  const feats = [
    { icn: 'user', tt: 'f8T', dd: 'f8D' },
    { icn: 'clock', tt: 'f1T', dd: 'f1D' },
    { icn: 'note', tt: 'f2T', dd: 'f2D' },
    { icn: 'shield', tt: 'f3T', dd: 'f3D' },
    { icn: 'globe', tt: 'f4T', dd: 'f4D' },
    { icn: 'zap', tt: 'f7T', dd: 'f7D' },
    { icn: 'code', tt: 'f5T', dd: 'f5D' },
    { icn: 'database', tt: 'f6T', dd: 'f6D' },
  ];
  const grid = h('section', { class: 'ab-grid' },
    h('h2', { class: 'ab-h2' }, icon('spark'), t('aboutFeatures')),
    h('div', { class: 'ab-grid__in' }, feats.map((f, i) =>
      h('article', { class: 'ab-card glass tilt', style: { animationDelay: `${i * 60}ms` } },
        h('div', { class: 'ab-card__row' },
          h('span', { class: 'ab-card__icn' }, icon(f.icn)),
          h('h3', {}, t(f.tt))),
        h('p', {}, t(f.dd))))));

  // ---------- stats strip (count-up, RTL-safe) ----------
  const stats = h('section', { class: 'ab-stats' },
    stat(icon('user'), 2, lang === 'fa' ? 'حالت حساب' : 'account modes'),
    stat(icon('globe'), '∞', lang === 'fa' ? 'دامنه' : 'domains'),
    stat(icon('shield'), 6, lang === 'fa' ? 'رقم برای هر کد' : 'digit codes'),
    stat(icon('lock'), 'AES-GCM', lang === 'fa' ? 'رمزنگاری در حال استراحت' : 'encryption at rest'),
  );
  function stat(icn, v, l) {
    const num = typeof v === 'number';
    const b = num
      ? h('b', { class: 'ab-stat__v', dataset: { count: String(v) } }, FA(Math.round(v * 0.6)))
      : h('b', { class: 'ab-stat__v ab-stat__v--txt' }, v);
    return h('div', { class: 'ab-stat glass' },
      h('span', { class: 'ab-stat__icn' }, icn),
      h('div', { class: 'ab-stat__txt' }, b, h('span', { class: 'ab-stat__l' }, l)));
  }

  // ---------- stack ----------
  const stack = ['Cloudflare Workers', 'Cloudflare D1', 'Hono', 'WebCrypto', 'postal-mime', 'Vanilla JS', 'Zero CDN'];
  const stackRow = h('section', { class: 'ab-stack glass' },
    h('b', { class: 'ab-stack__t' }, t('aboutStack')),
    h('div', { class: 'ab-stack__chips' }, stack.map((s) => h('span', { class: 'chip' }, h('span', { class: 'chip-dot' }, ''), s))));

  // ---------- creator — the maker card, front and center ----------
  const creator = h('section', { class: 'ab-creator glass' },
    h('div', { class: 'ab-creator__glow', 'aria-hidden': 'true' }),
    h('span', { class: 'ab-creator__ava' }, 'E'),
    h('div', { class: 'ab-creator__txt' },
      h('div', { class: 'ab-creator__id' },
        h('h3', {}, 'Erfan'),
        h('span', { class: 'chip' }, icon('spark'), t('aboutMakerRole'))),
      h('p', {}, t('aboutCreatorD')),
      h('div', { class: 'ab-creator__links' },
        h('a', { class: 'btn btn--sm', href: 'https://github.com/Erfan-8910', target: '_blank', rel: 'noopener' }, icon('code'), t('viewGithub')),
        h('a', { class: 'btn btn--sm btn--primary', href: 'https://github.com/Erfan-8910/CMail', target: '_blank', rel: 'noopener' }, icon('heart'), t('viewProject')),
      )),
  );

  const made = h('p', { class: 'ab-made' }, t('madeBy'), h('span', { class: 'ab-made__heart', 'aria-label': 'heart' }, icon('heart')), t('madeByTail'), h('span', { class: 'version-pill' }, `Cmail v${VERSION} · ${FA(2025)}`));

  app.append(
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow' }, icon('heart'), t('eyebrowAbout')),
        h('h1', { class: 'page-title' }, t('navAbout')))),
    hero, updateCard(VERSION), ribbon, grid, stats, stackRow, creator, made,
  );

  // ---------- effects ----------
  animateCounters(stats);
  if (!reducedMotion) enableTilt(hero.querySelector('.ab-logo'), 10);
  if (!reducedMotion && window.matchMedia?.('(hover: hover)').matches) {
    app.querySelectorAll('.ab-card.tilt').forEach((c) => enableTilt(c, 4));
  }
}

// count-up when scrolled into view (starts close to the target — no zero flash)
function animateCounters(scope) {
  const els = scope.querySelectorAll?.('.ab-stat__v[data-count]');
  if (!els?.length) return;
  const fa = lang === 'fa';
  const fmt = (v) => fa ? String(v).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(v);
  if (reducedMotion) {
    els.forEach((el) => { el.textContent = fmt(el.dataset.count); });
    return;
  }
  const run = (el) => {
    const target = parseInt(el.dataset.count, 10);
    const from = Math.round(target * 0.6);
    const t0 = performance.now(), dur = 620;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(from + (target - from) * eased));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      run(en.target);
      io.unobserve(en.target);
    }
  }, { threshold: .2 });
  els.forEach((el) => io.observe(el));
}

// subtle 3D parallax tilt (pointer-follow, springs back)
function enableTilt(el, max = 6) {
  if (!el) return;
  let raf = null;
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - .5;
    const py = (e.clientY - r.top) / r.height - .5;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      el.style.transform = `perspective(700px) rotateY(${(px * max).toFixed(2)}deg) rotateX(${(-py * max).toFixed(2)}deg)`;
    });
  });
  el.addEventListener('pointerleave', () => {
    cancelAnimationFrame(raf);
    el.style.transition = 'transform .6s cubic-bezier(.34,1.42,.4,1)';
    el.style.transform = '';
    setTimeout(() => { el.style.transition = ''; }, 620);
  });
}
