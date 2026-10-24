// Cmail — creator view
import { t } from '../i18n.js';
import { h, icon } from '../ui.js';

export function renderCreator(root) {
  const view = h('div', { class: 'view view--auth' });
  const wrap = h('div', { class: 'creator-wrap' });

  const card = h('div', { class: 'glass creator-card' },
    h('img', { class: 'creator-logo', src: 'assets/img/logo-dark.png', alt: 'Cmail' }),
    h('div', { class: 'creator-name' }, 'Cmail'),
    h('div', { class: 'creator-role' }, t('tagline')),

    h('div', { class: 'creator-badges' },
      h('span', { class: 'chip' }, icon('zap'), 'Cloudflare Workers'),
      h('span', { class: 'chip' }, icon('shield'), '2FA Vault'),
      h('span', { class: 'chip' }, icon('globe'), 'Multi-domain'),
      h('span', { class: 'chip' }, icon('note'), t('navMail') + ' Notes'),
    ),

    h('div', { style: { margin: '26px 0 4px', display: 'grid', placeItems: 'center' } },
      h('div', { class: 'avatar', style: { width: '72px', height: '72px', fontSize: '28px', borderRadius: '24px', boxShadow: '0 14px 40px -8px rgba(124,140,255,.6)' } }, 'E'),
      h('div', { class: 'creator-name', style: { fontSize: '21px' } }, t('byName')),
      h('div', { class: 'creator-role' }, t('madeBy')),
      h('p', { class: 'creator-role', style: { maxWidth: '380px', margin: '10px auto 0', lineHeight: 1.9 } }, t('creatorBio')),
    ),

    h('div', { class: 'creator-links' },
      h('a', { class: 'btn', href: 'https://github.com/Erfan-8910', target: '_blank', rel: 'noopener' }, icon('code'), t('viewGithub')),
      h('a', { class: 'btn btn--primary', href: 'https://github.com/Erfan-8910/CMail', target: '_blank', rel: 'noopener' }, icon('external'), t('viewProject')),
      h('a', { class: 'btn', href: 'https://github.com/Erfan-8910/Climind-W', target: '_blank', rel: 'noopener' }, icon('heart'), t('viewClimind')),
    ),
  );

  wrap.append(card, h('div', { style: { textAlign: 'center', marginTop: '14px' } }, h('span', { class: 'version-pill' }, 'Cmail v1.0.0')));
  view.append(wrap);
  root.append(view);
}
