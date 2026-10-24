// Cmail — About view: the story, the features, the stack, the maker.
import { t, lang } from '../i18n.js';
import { h, icon } from '../ui.js';

export function renderAbout(root) {
  const app = root;
  const FA = (n) => lang === 'fa' ? String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(n);

  // ---------- hero ----------
  const hero = h('section', { class: 'ab-hero glass' },
    h('div', { class: 'ab-hero__glow', 'aria-hidden': 'true' }),
    h('img', { class: 'ab-logo', src: 'assets/img/logo-dark.png', alt: 'Cmail' }),
    h('h1', { class: 'ab-title' }, 'Cmail'),
    h('p', { class: 'ab-lead' }, t('aboutLead')),
    h('div', { class: 'ab-hero__meta' },
      h('span', { class: 'chip' }, icon('spark'), `${t('aboutVersion')} 1.2.0`),
      h('span', { class: 'chip' }, icon('lock'), t('aboutOpen')),
    ),
    h('div', { class: 'ab-hero__links' },
      h('a', { class: 'btn btn--primary', href: 'https://github.com/Erfan-8910/CMail', target: '_blank', rel: 'noopener' }, icon('external'), t('aboutGithub')),
      h('a', { class: 'btn', href: '#/help' }, icon('help'), t('aboutGuide')),
    ),
  );

  // ---------- feature grid ----------
  const feats = [
    { icn: 'clock', tt: 'f1T', dd: 'f1D' },
    { icn: 'note', tt: 'f2T', dd: 'f2D' },
    { icn: 'shield', tt: 'f3T', dd: 'f3D' },
    { icn: 'globe', tt: 'f4T', dd: 'f4D' },
    { icn: 'code', tt: 'f5T', dd: 'f5D' },
    { icn: 'leaf', tt: 'f6T', dd: 'f6D' },
  ];
  const grid = h('section', { class: 'ab-grid' },
    h('h2', { class: 'ab-h2' }, icon('spark'), t('aboutFeatures')),
    h('div', { class: 'ab-grid__in' }, feats.map((f, i) =>
      h('article', { class: 'ab-card glass', style: { animationDelay: `${i * 70}ms` } },
        h('span', { class: 'ab-card__icn' }, icon(f.icn)),
        h('h3', {}, t(f.tt)),
        h('p', {}, t(f.dd))))));

  // ---------- stack ----------
  const stack = ['Cloudflare Workers', 'Cloudflare D1', 'Hono', 'WebCrypto', 'postal-mime', 'Vanilla JS', 'Zero CDN'];
  const stackRow = h('section', { class: 'ab-stack glass' },
    h('b', { class: 'ab-stack__t' }, t('aboutStack')),
    h('div', { class: 'ab-stack__chips' }, stack.map((s) => h('span', { class: 'chip' }, s))));  // ---------- creator ----------
  const creator = h('section', { class: 'ab-creator glass' },
    h('div', { class: 'avatar', style: { width: '64px', height: '64px', fontSize: '24px', borderRadius: '22px', boxShadow: '0 14px 40px -8px color-mix(in srgb, var(--acc) 55%, transparent)' } }, 'E'),
    h('div', { class: 'ab-creator__txt' },
      h('h3', {}, icon('heart'), t('aboutCreatorT')),
      h('p', {}, t('aboutCreatorD')),
      h('div', { class: 'ab-creator__links' },
        h('a', { class: 'chip chip--link', href: 'https://github.com/Erfan-8910', target: '_blank', rel: 'noopener' }, icon('code'), 'Erfan — ' + t('viewGithub')),
        h('a', { class: 'chip chip--link', href: 'https://github.com/Erfan-8910/Climind-W', target: '_blank', rel: 'noopener' }, icon('heart'), t('viewClimind')),
      )),
  );

  // ---------- stats strip ----------
  const stats = h('section', { class: 'ab-stats' },
    stat(icon('mail'), FA('2'), lang === 'fa' ? 'حالت صندوق' : 'inbox modes'),
    stat(icon('globe'), '∞', lang === 'fa' ? 'دامنه' : 'domains'),
    stat(icon('shield'), FA('6'), lang === 'fa' ? 'رقم برای هر کد' : 'digit codes'),
    stat(icon('lock'), 'AES-GCM', lang === 'fa' ? 'رمزنگاری در حال استراحت' : 'encryption at rest'),
  );
  function stat(icn, v, l) {
    return h('div', { class: 'ab-stat glass' }, h('span', { class: 'ab-stat__icn' }, icn), h('b', {}, v), h('span', {}, l));
  }

  const made = h('p', { class: 'ab-made' }, t('madeBy'), h('span', { class: 'version-pill' }, `Cmail v1.2.0 · ${FA(2025)}`));

  app.append(
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'eyebrow' }, icon('heart'), t('eyebrowAbout')),
        h('h1', { class: 'page-title' }, t('navAbout')))),
    hero, grid, stats, stackRow, creator, made,
  );
}
