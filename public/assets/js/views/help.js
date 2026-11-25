// Cmail — help / setup guide view
// v3.1.5 — the guide grew into a searchable reference: one box filters every
// section live, and the pages the panel gained this release (the right-click
// menu, the official PDF export, the domain dossier) got chapters of their
// own — written for the person reading, not for the changelog.
import { t, lang } from '../i18n.js';
import { h, icon } from '../ui.js';
import { recoveryCopyLine, recoveryFreshBlock, stepRow } from './auth.js';

export function renderHelp(root) {
  const fa = lang === 'fa';
  const view = h('div', { class: 'view' });
  view.append(h('div', { class: 'page-head' },
    h('div', {}, h('div', { class: 'eyebrow' }, t('eyebrowHelp')), h('h2', { class: 'page-title' }, t('helpTitle')), h('div', { class: 'page-sub' }, t('helpSub'))),
  ));

  // keyboard shortcuts
  // the keycaps avoid the risky glyphs: ↵ and the arrow pair are exactly the
  // characters some device fonts turn into empty boxes (⌘ stays for Mac
  // users only — that glyph ships with every Apple font)
  const isMacLike = () => /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
  const K = (keys, label) => h('div', { class: 'kb-row' },
    h('span', { class: 'kb-keys' }, keys.map((k) => h('kbd', { class: 'kbd' }, k))),
    h('span', { class: 'kb-lbl' }, label));
  const shortcuts = h('section', { class: 'glass card kb-card' },
    h('div', { class: 'card-head' }, icon('zap'), h('h3', {}, t('kbTitle'))),
    h('p', { class: 'small muted', style: { margin: '0 0 10px' } }, t('kbSub')),
    h('div', { class: 'kb-grid' },
      K([isMacLike() ? '⌘' : 'Ctrl', 'K'], t('kbPalette')),
      K(['/'], t('kbSearch')),
      K(['J', 'K'], t('kbNext')),
      K(['Enter'], t('kbOpen')),
      K(['X'], t('kbSelect')),
      K(['S'], t('kbStar')),
      K(['esc'], t('kbClose')),
    ));

  // ---------- live search over every chapter ----------
  const searchIn = h('input', { class: 'input', type: 'search', placeholder: t('helpSearchPh') });
  const searchCard = h('section', { class: 'glass card kb-card help-search' },
    h('div', { class: 'card-head' }, icon('search'), h('h3', {}, t('helpSearchT'))),
    h('p', { class: 'small muted', style: { margin: '0 0 10px' } }, t('helpSearchHint')),
    searchIn);
  searchIn.addEventListener('input', () => {
    const q = searchIn.value.trim().toLowerCase();
    const hit = (el) => !q || (el.textContent || '').toLowerCase().includes(q);
    for (const d of view.querySelectorAll('details.guide')) d.style.display = hit(d) ? '' : 'none';
    for (const sec of content.children) sec.style.display = hit(sec) ? '' : 'none';
    for (const sec of [shortcuts]) sec.style.display = hit(sec) ? '' : 'none';
  });

  const content = h('div', { class: 'glass card' });

  // 1 — install
  content.append(h('h3', { style: { fontSize: '16px', margin: '4px 0 10px' } }, '۱ · ' + t('installTitle')));
  const pre = h('pre', {}, fa
    ? `# ۱) پیش‌نیاز: Node.js 18+ و یک اکانت Cloudflare

# ۲) نصب خودکار (پیشنهادی):
git clone https://github.com/Erfan-8910/CMail.git
cd CMail
bash deploy.sh          # همه‌چیز را خودش انجام می‌دهد

# ۳) یا مرحله‌به‌مرحله:
npm install
npx wrangler login
npx wrangler d1 create cmail-db      # database_id را در wrangler.jsonc بگذار
npx wrangler d1 migrations apply cmail-db --remote
npx wrangler secret put APP_SECRET   # یک رشته تصادفی طولانی
npx wrangler deploy`
    : `# 1) Prerequisites: Node.js 18+ and a Cloudflare account

# 2) One-command auto install (recommended):
git clone https://github.com/Erfan-8910/CMail.git
cd CMail
bash deploy.sh          # does everything for you

# 3) Or step by step:
npm install
npx wrangler login
npx wrangler d1 create cmail-db      # put database_id in wrangler.jsonc
npx wrangler d1 migrations apply cmail-db --remote
npx wrangler secret put APP_SECRET   # a long random string
npx wrangler deploy`);
  content.append(pre);

  // 2 — email routing
  content.append(h('h3', { style: { fontSize: '16px', margin: '18px 0 10px' } }, '۲ · Email Routing'));
  content.append(h('div', { class: 'step-list' },
    stepRow(1, fa ? 'در داشبورد Cloudflare دامنه را باز کن و به Email Routing برو.' : 'Open your domain in the Cloudflare dashboard, go to Email Routing.',
      fa ? 'اگر اولین بار است، Cloudflare خودش رکوردهای MX و SPF را اضافه می‌کند.' : 'If this is the first time, Cloudflare adds the MX and SPF records for you.'),
    stepRow(2, fa ? ' Catch-all address → Edit → Action: «Send to a Worker»' : 'Catch-all address → Edit → Action: "Send to a Worker"',
      fa ? 'Worker به نام cmail را انتخاب کن و ذخیره کن.' : 'Pick the cmail worker and save.'),
    stepRow(3, fa ? 'برای ارجاع (Forwarding)، آدرس مقصد را در بخش Destination addresses تأیید کن.' : 'For forwarding, verify the destination in Destination addresses.'),
  ));

  // 3 — access & recovery
  content.append(h('h3', { style: { fontSize: '16px', margin: '18px 0 10px' } }, '۳ · ' + (fa ? 'ورود و بازیابی دسترسی' : 'Sign-in & recovery')));
  content.append(h('p', { class: 'small muted' },
    fa
      ? 'پنل تک‌کاربره است: در اولین باز شدن، نام کاربری و رمز خودت را می‌سازی و از آن به بعد همان‌ها کلید ورودند. اگر نام کاربری را از تنظیمات ← امنیت غیرفعال کنی، ورود فقط با رمز انجام می‌شود.'
      : 'The panel is single-user: on the very first open you choose a username and password, and from then on they are the only key. Disable the username in Settings → Security and the password alone is enough to sign in.'));

  const recBody = h('div', { class: 'small muted' });
  recBody.append(
    h('p', { style: { margin: '0 0 8px' } },
      fa
        ? 'رمزها هش‌شده ذخیره می‌شوند و قابل خواندن نیستند، اما با دو دستور ساده در Console دیتابیس، دسترسی‌ات را برمی‌گردانی:'
        : 'Passwords are stored hashed and can never be read back — but two simple statements in the database Console restore your access:'),
    stepRow(1, fa ? 'در داشبورد Cloudflare به مسیر Storage & Databases → D1 برو و دیتابیس cmail-db را باز کن.' : 'In the Cloudflare dashboard go to Storage & Databases → D1 and open the cmail-db database.',
      fa ? 'از تب Console استفاده کن.' : 'Use the Console tab.'),
    stepRow(2, fa ? 'برای پیدا کردن نام کاربری:' : 'To find your username:', ''),
  );
  recBody.append(recoveryCopyLine('SELECT username FROM users;'));
  recBody.append(stepRow(3, fa ? 'برای ریست رمز با یک گذرواژهٔ موقتِ یک‌بارمصرف (همین لحظه در مرورگرِ تو ساخته می‌شود):' : 'To reset the password with a one-off temporary value (generated in your browser, right now):', ''));
  recBody.append(...recoveryFreshBlock());
  recBody.append(stepRow(4, fa ? 'با همان نام کاربری و رمز موقتی که همین پنل ساخته وارد شو و بلافاصله از تنظیمات ← امنیت، رمز را عوض کن.' : 'Sign in with your username and the temporary password this panel just generated, then immediately change the password in Settings → Security.',
    fa ? 'هیچ ایمیلی حذف نمی‌شود؛ این دستور فقط رمز را عوض می‌کند.' : 'No mail is touched; the statement only replaces the password.'));
  recBody.append(h('p', { style: { margin: '8px 0 0' } },
    fa
      ? 'هشدار: هیچ‌وقت DELETE FROM users نزن — با حذف کاربر، همه صندوق‌ها و ایمیل‌های آن هم پاک می‌شوند. رمز موقت را حتماً بلافاصله عوض کن.'
      : 'Warning: never run DELETE FROM users — deleting the user wipes all of their inboxes and mail. Change the temporary password right away.'));
  content.append(h('details', { class: 'guide' },
    h('summary', {}, fa ? 'رمز یا نام کاربری‌ام را فراموش کرده‌ام' : 'I forgot my password or username'),
    recBody,
  ));

  // 4 — the inbox and its management surfaces (v3.1.5)
  content.append(h('h3', { style: { fontSize: '16px', margin: '18px 0 10px' } }, '۴ · ' + (fa ? 'صندوق و مدیریت نامه‌ها' : 'Inbox & mail management')));
  content.append(h('div', { class: 'step-list' },
    stepRow(1, fa ? 'روی هر نامه راست‌کلیک کن — منوی مدیریت همان‌جای نشانگر باز می‌شود: بازکردن، پاسخ، ستاره، خوانده/نخوانده، خروجی PDF، کپی آدرس، انتقال به پوشه و حذف.' : 'Right-click any letter — the management menu opens right at the pointer: open, reply, star, read/unread, PDF export, copy address, move to folder, delete.',
      fa ? 'روی موبایل هم دکمهٔ سه‌نقطهٔ هر ردیف همان منو را به‌صورت برگهٔ پایین صفحه باز می‌کند.' : 'On mobile, the row\'s three-dot button opens the same menu as a bottom sheet.'),
    stepRow(2, fa ? 'جریان‌های سریع دستی سر جایشان هستند: کشیدن ردیف به چپ حذف، به راست ستاره؛ نگه‌داشتن انگشت هم حالت انتخاب گروهی.' : 'Fast gestures stay: flick a row left to delete, right to star; long-press starts multi-select.',
      fa ? 'با کیبورد: J/K حرکت، Enter بازکردن، X انتخاب، S ستاره، / جست‌وجو.' : 'Keyboard: J/K move, Enter open, X select, S star, / search.'),
  ));

  // 5 — official PDF export (v3.1.5)
  content.append(h('h3', { style: { fontSize: '16px', margin: '18px 0 10px' } }, '۵ · ' + (fa ? 'خروجی PDF رسمی' : 'Official PDF export')));
  content.append(h('p', { class: 'small muted' },
    fa
      ? 'هر نامه — دریافتی یا ارسالی — می‌تواند به یک سند رسمی تبدیل شود: در صفحهٔ نامه دکمهٔ «خروجی PDF» هست، یا نامه را راست‌کلیک کن و همان گزینه را از منو بزن. سند خروجی سربرگ رسمی Cmail، مهر رسمی با تاریخ، جدول جزئیات (فرستنده، گیرنده، صندوق، نوع، حجم، مسیر ارسال و نتیجهٔ SPF/DKIM/DMARC)، خودِ نامه، فهرست پیوست‌ها و یادداشت را دارد — و همه‌چیز به همان زبانی که پنل تنظیم شده (فارسی راست‌به‌چپ یا انگلیسی) چاپ می‌شود. مرورگر پنجرهٔ چاپ را باز می‌کند؛ «ذخیره به‌صورت PDF» همان‌جاست.'
      : 'Every letter — received or sent — can become a formal document: use the “PDF export” button on the letter page, or right-click it and pick the same option from the menu. The document carries the official Cmail letterhead, a dated seal, the full details table (sender, recipient, mailbox, type, size, route and the SPF/DKIM/DMARC verdicts), the body itself, attachments and any note — all in the panel\'s own language (RTL Persian or English). The browser opens its print dialog; “Save as PDF” sits right there.'));

  // 6 — domains: the dossier and its troubleshooting (v3.1.5)
  content.append(h('h3', { style: { fontSize: '16px', margin: '18px 0 10px' } }, '۶ · ' + (fa ? 'دامنه‌ها و عیب‌یابی' : 'Domains & troubleshooting')));
  content.append(h('p', { class: 'small muted' },
    fa
      ? 'دکمهٔ «جزئیات» روی هر کارت دامنه یک پروندهٔ کامل باز می‌کند: آمار دامنه، وضعیت زندهٔ DNS از یک resolver واقعی (MX و SPF)، فهرست عیب‌یابی که هر مشکل را با راه‌حلش می‌گوید (ثبت ناتمام، کلید خاموش، Catch-all بسته، رکوردهای غایب، جریان نامهٔ ساکت) و جدول رکوردهای صحیح برای مقایسه. ویزارد اتصال هم حالا وفادار است: اگر وسط کار خارج شوی و برگردی، همان آدرس تأیید قبلی سر جایش است — فقط مهلتش ۲۴ ساعت تازه می‌شود و می‌توانی دوباره به همان ایمیل پیام بدهی.'
      : 'Each domain card\'s “Details” button opens a full dossier: the domain\'s numbers, live DNS status from a real resolver (MX and SPF), a troubleshooting list that names each problem with its fix (unfinished registration, inactive switch, closed catch-all, missing records, silent mail flow) and the exact records to compare against. The connect wizard is loyal now too: leave mid-way and come back, the same verification address is still yours — only its 24h window is re-armed, and you can mail it again.'));

  // 7 — troubleshooting
  content.append(h('h3', { style: { fontSize: '16px', margin: '18px 0 10px' } }, '۷ · ' + (fa ? 'رفع اشکال' : 'Troubleshooting')));

  const q = (summary, ...children) => h('details', { class: 'guide' }, h('summary', {}, summary), ...children);

  content.append(
    q(fa ? 'ایمیل‌ها نمی‌آیند!' : 'Emails are not arriving!',
      h('p', { class: 'small muted' }, fa
        ? '۱) وضعیت Email Routing را در داشبورد چک کن (باید Active باشد) ۲) Catch-all حتماً روی Send to Worker باشد ۳) لاگ زنده را با دستور زیر ببین'
        : '1) Check Email Routing status in the dashboard (must be Active) 2) Catch-all must be set to Send to Worker 3) Live logs with the command below'),
      recoveryCopyLine('npx wrangler tail')),
    q(fa ? 'ایمیل ارسال نمی‌شود' : 'Outgoing mail fails',
      h('p', { class: 'small muted' }, fa
        ? 'در تنظیمات → ارسال، سرویس (Brevo/Resend) و کلید API را چک کن؛ دامنه فرستنده باید در آن سرویس تأیید شده باشد. با دکمه «ارسال ایمیل تست» امتحان کن.'
        : 'In Settings → Outgoing mail, check the provider (Brevo/Resend) and API key; the sender domain must be verified on the provider. Use the test send button.'),
    ),
    q(fa ? 'وردکر نمی‌تواند دیپلوی کند' : 'Wrangler fails to deploy',
      h('p', { class: 'small muted' }, fa
        ? 'npx wrangler login را دوباره اجرا کن؛ مطمئن شو database_id در wrangler.jsonc درست است و مایگریشن‌ها را روی remote زده‌ای: npm run db:migrate:remote'
        : 'Run npx wrangler login again; make sure database_id in wrangler.jsonc is correct and migrations are applied remotely: npm run db:migrate:remote'),
      recoveryCopyLine('npm run db:migrate:remote')),
    q(fa ? 'چطور چند دامنه داشته باشم؟' : 'How to use multiple domains?',
      h('p', { class: 'small muted' }, fa
        ? 'هر دامنه را در Cloudflare فعال کن، بعد در بخش «دامنه‌ها» اضافه‌اش کن و Catch-all همان دامنه را به همین Worker وصل کن. ساخت صندوق برای همه دامنه‌ها فعال می‌شود.'
        : 'Enable each domain in Cloudflare, add it under "Domains" here, and point that domain\'s Catch-all to this worker. Creating inboxes across all domains works instantly.'),
    ),
  );

  view.append(searchCard);
  view.append(shortcuts);
  view.append(content);
  root.append(view);
}
