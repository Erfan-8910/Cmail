// Cmail — About view: the story, the features, the stack, the maker.
// Liquid-glass polish: animated counters, 3D tilt cards, glowing hero.
import { t, lang } from '../i18n.js';
import { h, icon } from '../ui.js';

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function renderAbout(root) {
  const app = root;
  const FA = (n) => lang === 'fa' ? String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(n);

  // ---------- hero ----------
  const hero = h('section', { class: 'ab-hero glass' },
    h('div', { class: 'ab-hero__glow', 'aria-hidden': 'true' }),
    h('img', { class: 'ab-logo', src: 'assets/img/logo-dark.png', alt: 'Cmail' }),
    h('p', { class: 'ab-lead' }, t('aboutLead')),
    h('div', { class: 'ab-hero__meta' },
      h('span', { class: 'chip' }, icon('spark'), `${t('aboutVersion')} 1.4.0`),
      h('span', { class: 'chip' }, icon('lock'), t('aboutOpen')),
    ),
    h('div', { class: 'ab-hero__links' },
      h('a', { class: 'btn btn--primary', href: 'https://github.com/Erfan-8910/CMail', target: '_blank', rel: 'noopener' }, icon('external'), t('aboutGithub')),
      h('a', { class: 'btn', href: '#/help' }, icon('help'), t('aboutGuide')),
    ),
  );

  // ---------- feature grid (3D tilt on hover) ----------
  const feats = [
    { icn: 'clock', tt: 'f1T', dd: 'f1D' },
    { icn: 'note', tt: 'f2T', dd: 'f2D' },
    { icn: 'shield', tt: 'f3T', dd: 'f3D' },
    { icn: 'globe', tt: 'f4T', dd: 'f4D' },
    { icn: 'zap', tt: 'f7T', dd: 'f7D' },
    { icn: 'code', tt: 'f5T', dd: 'f5D' },
    { icn: 'leaf', tt: 'f6T', dd: 'f6D' },
  ];
  const grid = h('section', { class: 'ab-grid' },
    h('h2', { class: 'ab-h2' }, icon('spark'), t('aboutFeatures')),
    h('div', { class: 'ab-grid__in' }, feats.map((f, i) =>
      h('article', { class: 'ab-card glass tilt', style: { animationDelay: `${i * 70}ms` } },
        h('span', { class: 'ab-card__icn' }, icon(f.icn)),
        h('h3', {}, t(f.tt)),
        h('p', {}, t(f.dd))))));

  // ---------- stats strip (animated counters) ----------
  const stats = h('section', { class: 'ab-stats' },
    stat(icon('mail'), 2, lang === 'fa' ? 'حالت صندوق' : 'inbox modes'),
    stat(icon('globe'), '∞', lang === 'fa' ? 'دامنه' : 'domains'),
    stat(icon('shield'), 6, lang === 'fa' ? 'رقم برای هر کد' : 'digit codes'),
    stat(icon('lock'), 'AES-GCM', lang === 'fa' ? 'رمزنگاری در حال استراحت' : 'encryption at rest'),
  );
  function stat(icn, v, l) {
    const num = typeof v === 'number';
    const b = num
      ? h('b', { class: 'ab-stat__v', dataset: { count: String(v) } }, lang === 'fa' ? '۰' : '0')
      : h('b', { class: 'ab-stat__v' }, v);
    return h('div', { class: 'ab-stat glass' }, h('span', { class: 'ab-stat__icn' }, icn), h('div', {}, b, h('span', {}, l)));
  }

  // ---------- stack ----------
  const stack = ['Cloudflare Workers', 'Cloudflare D1', 'Hono', 'WebCrypto', 'postal-mime', 'Vanilla JS', 'Zero CDN'];
  const stackRow = h('section', { class: 'ab-stack glass' },
    h('b', { class: 'ab-stack__t' }, t('aboutStack')),
    h('div', { class: 'ab-stack__chips' }, stack.map((s) => h('span', { class: 'chip' }, s))));
  // ---------- creator ----------
  const creator = h('section', { class: 'ab-creator glass' },
    h('div', { class: 'avatar', style: { width: '64px', height: '64px', fontSize: '24px', borderRadius: '22px', boxShadow: '0 14px 40px -8px color-mix(in srgb, var(--acc) 55%, transparent)' } }, 'E'),
    h('div', { class: 'ab-creator__txt' },
      h('h3', {}, icon('heart'), t('aboutCreatorT')),
      h('p', {}, t('aboutCreatorD')),
      h('div', { class: 'ab-creator__links' },
        h('a', { class: 'chip chip--link', href: 'https://github.com/Erfan-8910', target: '_blank', rel: 'noopener' }, icon('code'), 'Erfan — ' + t('viewGithub')),
        h('a', { class: 'chip chip--link', href: 'https://github.com/Erfan-8910/CMail', target: '_blank', rel: 'noopener' }, icon('heart'), t('viewProject')),
      )),
  );

  const made = h('p', { class: 'ab-made' }, t('madeBy'), h('span', { class: 'version-pill' }, `Cmail v1.4.0 · ${FA(2025)}`));

  app.append(
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow' }, icon('heart'), t('eyebrowAbout')),
        h('h1', { class: 'page-title' }, t('navAbout')))),
    hero, grid, stats, stackRow, creator, made,
  );

  // ---------- effects ----------
  animateCounters(stats);
  if (!reducedMotion) enableTilt(hero.querySelector('.ab-logo'), 10);
  if (!reducedMotion && window.matchMedia?.('(hover: hover)').matches) {
    app.querySelectorAll('.ab-card.tilt').forEach((c) => enableTilt(c, 5));
  }
}

// count-up when scrolled into view (keynote-style numbers)
function animateCounters(scope) {
  const els = scope.querySelectorAll?.('.ab-stat__v[data-count]');
  if (!els?.length) return;
  const run = (el) => {
    const target = parseInt(el.dataset.count, 10);
    const t0 = performance.now(), dur = 900;
    const fa = lang === 'fa';
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = Math.round(target * eased);
      el.textContent = fa ? String(val).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(val);
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
  }, { threshold: .4 });
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
