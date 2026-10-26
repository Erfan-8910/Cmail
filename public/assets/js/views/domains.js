// Cmail — domains view (admin)
import { api, errText } from '../api.js';
import { t, lang } from '../i18n.js';
import { h, clear, icon, toast, modal, confirmBox, copyText, timeAgo } from '../ui.js';

export async function renderDomains(root) {
  const view = h('div', { class: 'view' });
  view.append(h('div', { class: 'page-head' },
    h('div', {}, h('div', { class: 'eyebrow' }, t('eyebrowDomains')), h('h2', { class: 'page-title' }, t('domainsTitle')), h('div', { class: 'page-sub' }, t('domainsSub'))),
    h('button', { class: 'btn btn--primary', onclick: () => addModal(load) }, icon('plus'), t('addDomain')),
  ));

  const wrap = h('div', { class: 'glass', style: { padding: '6px', overflowX: 'auto' } });
  const table = h('table', { class: 'tbl' });
  wrap.append(table);
  view.append(wrap, h('div', { class: 'mt-2' }, routingHelp()));
  root.append(view);

  async function load() {
    try {
      const r = await api.get('/api/addresses/domains');
      draw(r.domains ?? []);
    } catch (e) { toast(errText(e), 'err'); }
  }

  function draw(domains) {
    clear(table);
    table.append(h('thead', {}, h('tr', {},
      h('th', {}, t('domain')), h('th', {}, t('domStatus')), h('th', {}, t('active')), h('th', {}, t('catchAll')), h('th', {}, t('addressesN')), h('th', {}, ''))));
    const tb = h('tbody', {});
    for (const d of domains) {
      tb.append(h('tr', {},
        h('td', {}, h('span', { class: 'mono', style: { fontWeight: 700 } }, d.name)),
        h('td', {}, healthChip(d)),
        h('td', {}, h('div', { class: `switch ${d.active ? 'is-on' : ''}`, onclick: async () => { await api.patch(`/api/addresses/domains/${d.id}`, { active: !d.active }); load(); } })),
        h('td', {}, h('div', { class: `switch ${d.catch_all ? 'is-on' : ''}`, onclick: async () => { await api.patch(`/api/addresses/domains/${d.id}`, { catch_all: !d.catch_all }); load(); } })),
        h('td', {}, String(d.address_count ?? 0)),
        h('td', {}, h('div', { class: 'row', style: { gap: '2px', justifyContent: 'flex-end' } },
          h('button', { class: 'icon-btn', title: t('dnsGuide'), onclick: () => dnsModal(d.name) }, icon('help')),
          h('button', { class: 'icon-btn', title: t('delete'), onclick: () => confirmBox(t('confirm'), async () => { await api.del(`/api/addresses/domains/${d.id}`); load(); }) }, icon('trash')),
        ))));
    }
    table.append(tb);
  }

  // setup health: is this domain actually receiving mail, or is something missing?
  function healthChip(d) {
    const st = !d.active ? ['dom-st--off', 'domOff']
      : !d.catch_all ? ['dom-st--warn', 'domNoCatch']
      : d.last_mail ? ['dom-st--ok', 'domHealthy']
      : ['dom-st--warn', 'domAwaiting'];
    const kids = [h('i'), h('span', {}, t(st[1]))];
    if (st[0] === 'dom-st--ok' && d.last_mail) {
      kids.push(h('span', { class: 'faint', style: { fontWeight: 600 } }, `· ${timeAgo(d.last_mail, t)}`));
    }
    return h('span', { class: `dom-st ${st[0]}`, title: t(st[1]) }, ...kids);
  }

  function addModal(onDone) {
    const name = h('input', { class: 'input ltr', placeholder: 'mail.example.com' });
    const label = h('input', { class: 'input', placeholder: t('label') });
    const catchAll = h('div', { class: 'switch is-on' });
    const m = modal({
      title: t('addDomain'), iconName: 'globe',
      body: [
        h('div', { class: 'field' }, h('label', {}, t('domainName')), name),
        h('div', { class: 'field' }, h('label', {}, t('label')), label),
        h('div', { class: 'set-row' }, h('div', {}, h('div', { class: 'set-row__t' }, t('catchAll'))), catchAll),
      ],
      footer: [
        h('button', { class: 'btn btn--ghost', onclick: () => m.close() }, t('cancel')),
        h('button', { class: 'btn btn--primary', onclick: async () => {
          try {
            const r = await api.post('/api/addresses/domains', { name: name.value.trim().toLowerCase(), label: label.value.trim(), catch_all: catchAll.classList.contains('is-on') });
            toast(t('saved'), 'ok', 1400);
            m.close();
            dnsModal(r.domain.name);
            onDone();
          } catch (e) { toast(errText(e), 'err'); }
        } }, t('save')),
      ],
    });
    catchAll.addEventListener('click', () => catchAll.classList.toggle('is-on'));
  }

  function dnsModal(domain) {
    const m = modal({
      wide: true,
      title: `${t('dnsGuide')} — ${domain}`, iconName: 'help',
      body: [
        h('table', { class: 'dns-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Name'), h('th', {}, 'Value'), h('th', {}, 'Priority'))),
          h('tbody', {},
            h('tr', {}, h('td', {}, 'MX'), h('td', {}, '@'), h('td', {}, h('code', {}, 'route1.mx.cloudflare.net')), h('td', {}, '10')),
            h('tr', {}, h('td', {}, 'MX'), h('td', {}, '@'), h('td', {}, h('code', {}, 'route2.mx.cloudflare.net')), h('td', {}, '20')),
            h('tr', {}, h('td', {}, 'MX'), h('td', {}, '@'), h('td', {}, h('code', {}, 'route3.mx.cloudflare.net')), h('td', {}, '30')),
            h('tr', {}, h('td', {}, 'TXT (SPF)'), h('td', {}, '@'), h('td', {}, h('code', {}, 'v=spf1 include:_spf.mx.cloudflare.net ~all')), h('td', {}, '—')),
          )),
        h('div', { class: 'step-list' },
          step(lang === 'fa'
            ? 'در داشبورد Cloudflare روی دامنه برو و Email Routing را فعال کن.'
            : 'Open the domain in the Cloudflare dashboard and enable Email Routing.'),
          step(lang === 'fa'
            ? 'در تب Routing → Catch-all address، اقدام (Action) را روی Send to Worker بگذار و Worker به نام cmail را انتخاب کن.'
            : 'In Routing → Catch-all address, set the Action to Send to Worker and pick the cmail worker.'),
          step(lang === 'fa'
            ? 'برای آدرس‌های خاص می‌توانی Custom address هم تعریف کنی؛ ولی Catch-all همه چیز را پوشش می‌دهد.'
            : 'You can define custom addresses too, but Catch-all covers everything.'),
        ),
      ],
      footer: [h('button', { class: 'btn', onclick: () => m.close() }, t('cancel'))],
    });
  }

  function step(text) {
    return h('div', { class: 'step-row' }, h('span', { class: 'step-row__num' }, '•'), h('div', { class: 'step-row__body' }, h('p', {}, text)));
  }

  function routingHelp() {
    return h('details', { class: 'guide' },
      h('summary', {}, icon('info'), lang === 'fa' ? 'چطور چند دامنه اضافه کنم؟' : 'How do I add multiple domains?'),
      h('p', { class: 'small muted' },
        lang === 'fa'
          ? 'هر دامنه (یا ساب‌دامنه) را باید در Cloudflare ثبت کرده باشی. برای هر کدام: ۱) Email Routing را فعال کن ۲) دامنه را همین‌جا اضافه کن ۳) Catch-all را به Worker وصل کن. از این به بعد هر ایمیل به هر آدرس از آن دامنه به Cmail می‌آید.'
          : 'Each domain (or subdomain) must be on your Cloudflare account. For each one: 1) enable Email Routing, 2) add the domain here, 3) point Catch-all to the worker. From then on, mail to any address on that domain lands in Cmail.'));
  }

  await load();
}
