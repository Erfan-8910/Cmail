<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-white.png">
  <img src="docs/logo-black.png" width="210" alt="Cmail — logo">
</picture>

# Cmail

**A calm, complete mail ecosystem that lives entirely inside your own Cloudflare account.**

Temporary & permanent inboxes · notes on every email · built-in 2FA vault · unlimited domains · outgoing mail · zero servers, zero monthly bills

[![Version](https://img.shields.io/badge/version-2.0.0-4f8f60)](https://github.com/Erfan-8910/Cmail/releases)
[![Deploy](https://img.shields.io/badge/deploy-one%20file%20%2B%20one%20binding-3d7a4f)](#installation)
[![License](https://img.shields.io/badge/license-MIT-56725c)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-F38020)](https://workers.cloudflare.com)
[![PRs](https://img.shields.io/badge/PRs-welcome-b4cda3)](https://github.com/Erfan-8910/Cmail/pulls)

**فارسی** — [English](#english)

</div>

<a id="farsi"></a>

---

<div align="center">

## 🇮🇷 راهنمای فارسی

</div>

### Cmail چیه؟

Cmail از یک سؤال ساده شروع شد: **چرا برای یک صندوق ایمیل باید اجاره‌بها بدهیم؟**

ایمیل معمول یعنی یک سرور اجاره‌ای، یک دیتابیس که خودت باید نگه‌اش داری، و صورتحساب ماهانه‌ای که یادت می‌رود. Cmail همه‌ی این‌ها را دور انداخته. کل این اکوسیستم روی همان حساب Cloudflare‌ای که از قبل داری اجرا می‌شود: ایمیل‌های ورودی با **Email Routing** می‌رسند، داده‌ها در **D1** (همان SQLite لبه‌ی Cloudflare) می‌مانند و کل رابط کاربری توسط یک **Worker** سرو می‌شود. نه سروری داری، نه فاکتوری، نه پنل اجاره‌ای.

نتیجه‌اش یک فضای شخصی است که مالکش خودت هستی؛ از دامنه‌اش تا آخرین بایت داده‌اش. هر وقت خواستی پاکش کنی، خواستی ببری‌اش جایی دیگر — اختیار کامل دست خودت است.

و چون یک «صندوق» بیشتر نیست، Cmail خودش را فقط یک اینباکس نمی‌داند؛ یک اکوسیستم است: صندوق موقت برای ثبت‌نام‌ها، صندوق دائمی برای کارهای واقعی، یادداشت رنگی زیر هر ایمیل، گاوصندوق کدهای دومرحله‌ای، و ارسال ایمیل از دامنه‌ی خودت — همه در یک پنل شیشه‌ای و آرام.

### تازه‌های نسخهٔ ۲.۰ — نصب، یک فایل و یک اتصال

این نسخه یک بار برای همیشه نصب را ساده کرد:

- **همه‌چیز داخل `worker.js` است.** صفحات، استایل‌ها، اسکریپت‌ها، فونت‌ها و آیکون‌ها — همه داخل همان یک فایل جاسازی شده‌اند. دیگر خبری از «آپلود پوشهٔ ظاهر»، «Attach assets» یا اتصال اضافه نیست؛ فقط **Edit Code + یک Binding**.
- **ساخت جدول‌ها با یک کلیک.** صفحهٔ راه‌اندازی حالا دکمهٔ **«ساخت خودکار جداول D1»** دارد؛ با یک لمس همهٔ ۱۱ جدول و ۱۴ شاخص ساخته می‌شوند. دیگر نیازی به کپی‌کردن SQL در کنسول نیست — البته اگر دوست داشتی، فایل [`schema.sql`](schema.sql) همچنان یک‌جا و idempotent هست و اجرای تکراری‌اش خطا نمی‌دهد.
- **خداحافظی با «internal server error».** اگر اتصال D1 جا افتاده باشد یا جدول‌ها ساخته نشده باشند، Worker به‌جای خطای خام یک **صفحهٔ راهنمای دوزبانه** نشان می‌دهد که دقیقاً می‌گوید چه قدمی مانده. در مسیرهای عادی، هر خطای غیرمنتظره هم به همین صفحهٔ آرام تبدیل می‌شود، نه ارور سرور.
- **دیتابیس بهینه‌تر.** شاخص‌های تازه برای پرس‌وجوهای واقعی (لیست صندوق، شمارش نخوانده‌ها، پاک‌سازی کرون) و یک مایگریشن [`0004_performance_indexes.sql`](migrations/0004_performance_indexes.sql) برای نصب‌های قدیمی.

### این پروژه برای چه کسی است؟

- **برای کسی که از اسپم خسته شده** — به‌جای دادن آدرس اصلی‌ات به هر سایتی، برای هر ثبت‌نام یک آدرس یک‌ساعته بساز؛ آدرس واقعی‌ات همیشه تمیز می‌ماند.
- **برای توسعه‌دهنده‌ها و تسترها** — ده‌ها صندوق تست بساز، ایمیل‌های سیستم را بگیر، دامنه‌های مختلف را امتحان کن و هر کدام را که تمام شد بگذار منقضی شود.
- **برای کسی که حریم خصوصی برایش مهم است** — هیچ آماری، هیچ اسکریپت ثالث، هیچ CDN؛ همه‌چیز روی حساب خودت، با کلیدهای خودت.
- **برای مالکان دامنه** — دامنه‌هایت را که روی Cloudflare نشسته‌اند به یک اکوسیستم ایمیل کامل تبدیل کن؛ هر دامنه، هر تعداد آدرس.
- **برای هر کسی که دوست دارد ابزارش «مال او» باشد** — یک بار راه می‌اندازی‌اش و برای همیشه مال خودت است.

### چه چیزهایی دارد؟

| | |
|---|---|
| 📬 **صندوق موقت + دائمی** | آدرس موقت با TTL (یک‌ساعته، یک‌روزه، هر چیزی) و شمارش معکوس زنده؛ آدرس دائمی که برای همیشه مال توست. |
| 🌐 **دامنه‌های نامحدود** | هر دامنه‌ای که روی Cloudflare داری را وصل کن؛ یک Worker همه را دریافت می‌کند. |
| 🗒️ **یادداشت روی هر ایمیل** | یادداشت رنگی شخصی زیر هر پیام — شماره سفارش، لینک جلسه، هر چیزی. جستجو همان‌جا پیدایش می‌کند. |
| 👤 **هر حساب، یک دنیا** | هر صندوق مثل یک حساب مستقل رفتار می‌کند: نامه‌ها، یادداشت‌های اختصاصی و کدهای 2FA همان سرویس فقط روی همان حساب می‌مانند؛ از کنار لیست حساب‌ها اضافه‌اش می‌کنی، مثل اضافه‌کردن یک حساب تازه. |
| 🔐 **گاوصندوق 2FA با لوگو** | احراز‌کننده‌ی داخلی: کدهای ۶ رقمی زنده با حلقه‌ی شمارش معکوس، رمزنگاری‌شده با AES-256-GCM؛ برای هر کد یک نشان از کتابخانه‌ی ۷۷ نماد آماده انتخاب کن، در پوشه بچین و حسابش را به یک صندوق وصل کن. |
| 🛡️ **ورود دومرحله‌ای حساب** | خودِ ورود به پنل هم می‌تواند 2FA داشته باشد. |
| 📤 **ارسال ایمیل** | با یک کلید API به Brevo یا Resend وصل شو و از دامنه‌ی خودت ایمیل بفرست. |
| ➡️ **ارجاع (Forwarding)** | هر صندوق می‌تواند کپی ایمیل‌هایش را به یک آدرس واقعی هم بفرستد. |
| ⌘ **پالت فرمان** | با <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> هر جا که هستی بپر هر جا می‌خواهی؛ همزمان نتیجه‌ی جستجوی ایمیل‌ها هم زنده می‌آید. |
| ⌨️ **کیبورد‌محور** | `j`/`k` حرکت، `Enter` بازکردن، `x` انتخاب، `s` ستاره — نقشه‌ی کامل میان‌برها داخل خود اپ هست. |
| 🧹 **پاک‌سازی خودکار** | یک کرون ساعتی صندوق‌های منقضی و ایمیل‌های قدیمی را خودش جمع می‌کند. |
| 🌙 **رابط شیشه‌ای** | تم شب و روز، شفافیت شیشه‌ی قابل تنظیم، ۱۳ پالت رنگ نام‌دار، فارسی (راست‌به‌چپ) و انگلیسی. |
| 📱 **کاملاً واکنش‌گرا** | از ۳۲۰ پیکسل موبایل تا دسکتاپ ۱۹۲۰ — ستون‌ها به دراور و شیت تبدیل می‌شوند. |
| 🔒 **داده‌ات، قانون تو** | D1 مال توست، کلیدها مال توست. هیچ‌کس دیگری داده‌ات را ندارد. |

### نگاهی به داخل

<div align="center">

| صندوق ورودی | خواندن ایمیل فارسی، راست‌به‌چپ |
|---|---|
| <img src="docs/screenshot-inbox.png" width="440" alt="inbox"> | <img src="docs/screenshot-reader.png" width="440" alt="reader"> |

| پالت فرمان ⌘K | گاوصندوق 2FA با کد زنده |
|---|---|
| <img src="docs/screenshot-cmdk.png" width="440" alt="cmdk"> | <img src="docs/screenshot-vault.png" width="440" alt="vault"> |

| تم روشن (فارسی) | تنظیمات — دسترسی و ورود |
|---|---|
| <img src="docs/screenshot-light.png" width="440" alt="light"> | <img src="docs/screenshot-settings.png" width="440" alt="settings"> |

| صفحه‌ی ورود | موبایل |
|---|---|
| <img src="docs/screenshot-login.png" width="440" alt="login"> | <img src="docs/screenshot-mobile-fa.png" width="220" alt="mobile"> <img src="docs/screenshot-mobile-mail.png" width="220" alt="mobile mail"> |

</div>

### نصب — سه راه

> پیش‌نیازها: فقط یک **حساب Cloudflare** (پلن رایگان کاملاً کافی است). برای راه‌های ترمینالی: Node.js نسخهٔ ۱۸ به بالا.

### ⬇️ دانلود آماده — بدون کلون کردن ریپو

- **فایل آمادهٔ [`worker.js`](https://github.com/Erfan-8910/Cmail/releases/download/v2.0.0/worker.js)** — کل برنامه در یک فایل (~۱.۱MB). برای راه ۲ فقط همین یکی کافی است.
- **بستهٔ کامل v2.0.0:** [`CMail-v2.0.0.zip`](https://github.com/Erfan-8910/Cmail/releases/download/v2.0.0/CMail-v2.0.0.zip) — همه‌ی فایل‌ها: سورس، `schema.sql`، مایگریشن‌ها و اسکریپت‌ها. فهرست همه‌ی نسخه‌ها: [Releases](https://github.com/Erfan-8910/Cmail/releases)

#### راه ۱ — خودکار با یک دستور (ترمینال)

```bash
git clone https://github.com/Erfan-8910/CMail.git
cd CMail
bash deploy.sh
```

نصب‌کننده خودش همه‌چیز را انجام می‌دهد: دیتابیس D1 را می‌سازد، جدول‌ها را می‌سازد، یک `APP_SECRET` تصادفی محکم تولید می‌کند، Worker را منتشر می‌کند و آخرش آدرس پنل را برایت چاپ می‌کند.

#### راه ۲ — کاملاً گرافیکی، روی dash.cloudflare.com، بدون حتی یک دستور

تمام کاری که باید بکنی همین است — فقط مرورگر و داشبورد Cloudflare. چهار قدم، بدون SQL، بدون آپلود پوشه:

**۱) دیتابیس را بساز**
- وارد [dash.cloudflare.com](https://dash.cloudflare.com) شو ← از منوی کنار: **Storage & Databases ← D1 SQL Database ← Create**
- اسمش را بگذار `cmail-db` و Create را بزن. همین! ساختن جدول‌ها کارِ خودِ Cmail است — نیازی به کنسول و SQL نیست.

**۲) Worker را بساز و کد را جای‌گذاری کن**
- از منو: **Workers & Pages ← Create ← Workers ← Create Worker**
- اسمش را بگذار `cmail` و یک بار با همان کد پیش‌فرض **Deploy** بزن.
- روی **Edit code** بزن؛ تمام کد پیش‌فرض را پاک کن، محتوای کامل فایل [`worker.js`](worker.js) (مستقیم از [دانلود آماده](https://github.com/Erfan-8910/Cmail/releases/download/v2.0.0/worker.js)) را جای آن پیست کن و **Deploy** بزن.

**۳) فقط یک اتصال: D1**
- برگرد به Worker: **Settings ← Bindings ← Add**
- نوع **D1 database** ← نام متغیر: `DB` ← دیتابیس: `cmail-db` ← Save / Deploy.
- (اختیاری ولی توصیه‌شده) در همان‌جا یک **Secret** هم بساز: نام `APP_SECRET` ← مقدار: یک رشتهٔ طولانی و تصادفی. این کلید رمزنگاری داخلی اپ است؛ یک بار می‌سازی و دیگر عوضش نمی‌کنی.

**۴) زمان‌بندی پاک‌سازی**
- **Settings ← Trigger Events ← Cron Triggers ← Add** و این را وارد کن: `17 * * * *`

**۵) تمام!** آدرس `https://cmail.<زیر-دامنه-تو>.workers.dev` را باز کن. صفحهٔ «راه‌اندازی سامانه» باز می‌شود:
- اگر اتصال D1 درست باشد، فقط دکمهٔ **«ساخت خودکار جداول D1»** را می‌بینی — یک کلیک و همهٔ جدول‌ها ساخته می‌شوند (اگر خطا دیدی، همان صفحه دقیقاً می‌گوید کدام قدم جا افتاده).
- بعد از خودت **نام کاربری و رمز** می‌سازد، بعد دامنه و سرویس ارسال را با آموزش قدم‌به‌قدم وصل می‌کند.

> 💡 راه میان‌بر: در صفحه‌ی **Workers & Pages ← Create** می‌توانی به‌جای ساخت دستی، ریپوی گیت‌هاب را متصل کنی (Connect to Git) تا خودِ Cloudflare هر بار از روی ریپو بسازد و منتشر کند. فقط قبلش در فایل `wrangler.jsonc` مقدار `REPLACE_WITH_D1_ID` را با شناسه‌ی واقعی دیتابیس قدم ۱ عوض کن.

#### راه ۳ — ترمینال، قدم‌به‌قدم

<details>
<summary><b>برای کسانی که ترمینال دوست دارند</b> (باز کن)</summary>

```bash
git clone https://github.com/Erfan-8910/CMail.git
cd CMail
npm install
npx wrangler login

npx wrangler d1 create cmail-db
#   شناسه‌ی برگشتی (database_id) را در wrangler.jsonc جای REPLACE_WITH_D1_ID بگذار
npx wrangler d1 migrations apply cmail-db --remote
npx wrangler secret put APP_SECRET     # یک رشته‌ی تصادفی طولانی
npx wrangler deploy
```

ساخت جدول‌ها با CLI به‌صورت مایگریشن انجام می‌شود (`0001` تا `0004`)؛ اگر خواستی همه را یک‌جا بسازی: `npx wrangler d1 execute cmail-db --remote --file=schema.sql`.

بعد در داشبورد: دامنه‌ات ← **Email ← Email Routing** را فعال کن ← **Catch-all address ← Action: Send to Worker ← cmail**.

</details>

#### راه دستی برای جدول‌ها (اگر روزی لازم شد)

<details>
<summary><b>ساخت دستی جداول با یک فایل واحد</b> (باز کن)</summary>

اگر به هر دلیلی خواستی جدول‌ها را خارج از اپ بسازی، دیگر سه فایل و ترتیب‌بندی نیست — یک فایل هست: [`schema.sql`](schema.sql). این فایل:

- شکل نهایی همه‌ی ۱۱ جدول را دارد (ستون‌های یادداشت‌ها، پوشه‌ها و نشان‌ها از قبل داخلشان است)؛
- کاملاً idempotent است — همه‌ی دستورها `IF NOT EXISTS` دارند، پس اجرای تکراری خطا نمی‌دهد؛
- شاخص‌های بهینه‌شده برای پرس‌وجوهای واقعی داخلش هستند.

اجرای آن یا از **Console** تب دیتابیس D1 در داشبورد است (کپی ← پیست ← Execute)، یا از ترمینال:

```bash
npx wrangler d1 execute cmail-db --remote --file=schema.sql
```

برای نصب‌های قدیمی‌تر که فقط `0001` را اجرا کرده‌اند، مایگریشن‌های `0002` و `0003` به‌ترتیب اجرا شوند یا صرفاً در اپ دکمهٔ ساخت خودکار جداول را بزنید — دستورهای ترمیمیِ همان دکمه ستون‌های جاافتاده را بدون خطا اضافه می‌کند.

</details>

### دریافت ایمیل: دامنه و Email Routing

دامنه‌ات باید روی DNS کلادفلر باشد (پلن رایگان کافی است). یک زیردامنه مثل `mail.yourdomain.com` هم عالی جواب می‌دهد. بعد در Cmail از بخش **دامنه‌ها** آن را اضافه کن — حالا هر دامنه یک نشان سلامت زنده دارد که یک‌نگاهی می‌گوید اتصال واقعاً در حال دریافت نامه است یا نه. برای هر دامنه، وقتی Email Routing را فعال کنی Cloudflare خودش این رکوردها را می‌گذارد:

| رکورد | مقدار | توضیح |
|---|---|---|
| MX | `route1.mx.cloudflare.net` (اولویت ۱۰) | خودکار |
| MX | `route2.mx.cloudflare.net` (اولویت ۲۰) | خودکار |
| MX | `route3.mx.cloudflare.net` (اولویت ۳۰) | خودکار |
| TXT (SPF) | `v=spf1 include:_spf.mx.cloudflare.net ~all` | خودکار |

آخرین قدم، مهم‌ترین قدم: **Email Routing ← Routing rules ← Catch-all address ← Action: Send to Worker ← cmail**. از این لحظه **هر** آدرسی روی دامنه‌ات (هر چیزی که جلوی @ بنویسی) به Cmail می‌رسد؛ با قابلیت ساخت خودکار صندوق موقت، همان آدرس‌های ناشناخته فوراً یک صندوق یک‌ساعته می‌شوند — یعنی ماشین ایمیل‌های یک‌بارمصرف تو روشن است.

### ارسال ایمیل (اختیاری، ولی به‌صرفه)

Cmail از طریق **Brevo** (۳۰۰ ایمیل در روز، رایگان) یا **Resend** (۱۰۰ در روز، رایگان) ارسال می‌کند: در سرویس انتخابی حساب بساز، دامنه‌ی فرستنده را تأیید کن، بعد در Cmail برو به **تنظیمات ← ارسال ایمیل**، سرویس و کلید و آدرس فرستنده را بگذار و با دکمه‌ی تست امتحان کن. کلید API فقط در دیتابیس خودت ذخیره می‌شود و هیچ‌جای دیگری نمی‌رود.

### ورود، دسترسی و رمز

پنل **تک‌کاربره** است؛ ثبت‌نام و حساب دوم وجود ندارد. بار اول که آدرس پنل را باز کنی، از خودت یک **نام کاربری و رمز** می‌سازد و از آن به بعد فقط با همان‌ها می‌توانی وارد شوی. اگر دوست نداری هر بار نام کاربری را تایپ کنی، از **تنظیمات ← امنیت ← «ورود با نام کاربری»** آن را خاموش کن — از آن به بعد فقط رمز کافی است.

امنیتش هم جدی است: رمزها به‌صورت PBKDF2-SHA256 هش می‌شوند، نشست‌ها با کوکی httpOnly امن می‌مانند، ورود دومرحله‌ای (TOTP) هم برای خود حساب داری، و حدس‌زدن رمز هم با محدودیت نرخ روی هر IP عملاً بی‌فایده است.

### 🔑 اگر رمز یا نام کاربری را گم کردی

خبر خوب: لازم نیست دنبال راهنما بگردی — **راهنمای بازیابی همان صفحه‌ی ورود است**؛ زیر فرم ورود، بخش «راهنما و بازیابی دسترسی» را باز کن. دستورهای SQL آماده‌ی کپی هم همان‌جاست:

هیچ‌کس — حتی خود Cmail — نمی‌تواند رمز هش‌شده را بخواند؛ اما دسترسی‌ات را با دو دستور ساده در **Console دیتابیس** برمی‌گردانی:

1. وارد [dash.cloudflare.com](https://dash.cloudflare.com) شو ← **Storage & Databases ← D1 ← cmail-db** ← تب **Console**.
2. برای پیدا کردن **نام کاربری**:

```sql
SELECT username FROM users;
```

3. برای **ریست کردن رمز** به مقدار موقت `Recover-Cmail-2026`:

```sql
UPDATE users SET password_hash = 'pbkdf2$100000$Y21haWwtcmVjb3Zlci1zYWx0MQ==$lvVylyVdxsS9Ji19drxw9ko72vDhlyHCDf5dSIC9Z/c=' WHERE role = 'admin';
```

4. حالا با نام کاربری و رمز `Recover-Cmail-2026` وارد شو و **بلافاصله** از «تنظیمات ← امنیت» رمز را عوض کن. به هیچ ایمیلی دست نخورده؛ این دستور فقط رمز را عوض می‌کند.

> ⚠️ **هرگز `DELETE FROM users` نزن** — با حذف کاربر، همه‌ی صندوق‌ها و ایمیل‌هایش هم طبق زنجیره‌ی کلید خارجی پاک می‌شوند. همین UPDATE کافی و بی‌خطر است. رمز موقت را هم بلافاصله عوض کن.

### استفاده‌ی روزمره

- **صندوق بساز:** از بخش «صندوق‌ها» دامنه را انتخاب کن، هر اسمی که دوست داری جلوی @ بگذار (یا بزن تصادفی) و عمرش را انتخاب کن: یک ساعت، ۲۴ ساعت، یا همیشگی. موقت‌ها شمارش معکوس زنده دارند و می‌توانی عمرشان را تمدید کنی.
- **یادداشت بگذار:** هر ایمیل را که باز کنی پایینش کادر «یادداشت شخصی» است؛ پنج رنگ دارد، خودش ذخیره می‌شود و در جستجو هم پیدا می‌شود.
- **⌘K:** با <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> پالت باز می‌شود؛ بنویس تا بین صفحات و ایمیل‌ها زنده جستجو کند، با ↑↓ انتخاب و با ↵ برو.
- **گاوصندوق:** در «2FA Vault» هر کد را با اسمش اضافه کن؛ راز `otpauth://` را پیست کن یا QR را ایمپورت کن، برایش یکی از ۷۷ نشان آماده را بردار و اگر خواستی پوشه‌سازی کن. کدها هر ۳۰ ثانیه تازه می‌شوند و با یک کلیک کپی می‌شوند.
- **میان‌برها:** `/` جستجو، `j`/`k` حرکت، `Enter` بازکردن، `x` انتخاب، `s` ستاره، `Esc` برگشت — نقشه‌ی کامل داخل «راهنما».
- **شخصی‌سازی:** تم شب/روز، شفافیت شیشه، ۱۳ پالت رنگ نام‌دار و زبان فارسی/انگلیسی از تنظیمات.

### 🔧 عیب‌یابی

| نشانه | معنی | درمان |
|---|---|---|
| صفحهٔ راهنمای دوزبانه با عنوان «اتصال دیتابیس برقرار نیست» | اتصال D1 با نام `DB` ست نشده | قدم ۳ راهنمای نصب: Settings ← Bindings ← D1 ← نام متغیر `DB` |
| صفحهٔ راهنما با عنوان «جداول هنوز ساخته نشده‌اند» | اتصال هست، جدول‌ها نیست | صفحهٔ اصلی را باز کن و دکمهٔ «ساخت خودکار جداول» را بزن |
| ایمیل‌ها نمی‌آیند | معمولاً Catch-all | داشبورد ← دامنه ← Email Routing ← Catch-all ← Send to Worker ← `cmail`؛ نشان سلامت دامنه در اپ هم باید سبز شود |
| ایمیل ارسال نمی‌شود | کلید/فرستنده | تنظیمات ← ارسال ایمیل ← دکمهٔ تست؛ دامنهٔ فرستنده باید در همان سرویس تأیید شده باشد |
| خطای `1101` یا خطای خام Worker | نباید اتفاق بیفتد | Worker هر خطایی را به صفحهٔ راهنما تبدیل می‌کند؛ اگر دیدی، متن داخل صفحه برای گزارش کافی است — `npx wrangler tail` هم لاگ زنده می‌دهد |
| صفحه باز نمی‌شود و Worker هم پاسخ نمی‌دهد | مشکل داشبورد/سرویس | وضعیت [cloudflarestatus.com](https://www.cloudflarestatus.com) را چک کن |

### سوالات پرتکرار

<details>
<summary><b>چطور Cmail را به‌روز کنم؟</b></summary>

دو حالت: اگر با **راه ۲** نصب کرده‌ای، فقط `worker.js` نسخهٔ جدید را در Edit Code پیست کن و Deploy بزن — ساختار دیتابیس هم با دکمهٔ «ساخت خودکار جداول» در صفحهٔ راه‌اندازی ترمیم می‌شود (روی داده‌هایت چیزی نمی‌نویسد، فقط ستون‌های جاافتاده را اضافه می‌کند). اگر با **راه ۱/۳** نصب کرده‌ای: `git pull` و `npx wrangler deploy` (مایگریشن‌ها با `npx wrangler d1 migrations apply cmail-db --remote` خودشان اعمال می‌شوند).
</details>

<details>
<summary><b>چطور چند دامنه داشته باشم؟</b></summary>

هر دامنه را در Cloudflare فعال کن، در بخش «دامنه‌ها»ی Cmail اضافه‌اش کن و Catch-all همان دامنه را به همین Worker وصل کن. ساخت صندوق روی همه‌ی دامنه‌ها همان لحظه فعال می‌شود.
</details>

<details>
<summary><b>داده‌هایم کجا ذخیره می‌شوند و چطور بکاپ بگیرم؟</b></summary>

همه‌چیز در همان یک دیتابیس D1 خودت است. از داشبورد کلادفلر می‌توانی در هر لحظه برای D1 خروجی SQL بگیری — بکاپ یعنی همان.
</details>

<details>
<summary><b>حجم worker.js زیاد است؛ مشکلی ندارد؟</b></summary>

نه. حدود ۱.۱ مگابایت است چون کل رابط کاربری (شامل لوگوها و فونت‌ها) داخلش جاسازی شده؛ بعد از فشرده‌سازی gzip که Cloudflare خودش انجام می‌دهد، بسیار سبک‌تر می‌شود و در سقف پلن رایگان راحت جا می‌گیرد. در عوض دیگر هیچ فایل جدا و اتصال اضافه‌ای وجود ندارد.
</details>

---

<a id="english"></a>

---

<div align="center">

## 🇬🇧 English Guide

</div>

### What is Cmail?

Cmail started from a simple question: **why should anyone pay rent for a mailbox?**

The usual answer involves a rented server, a database you have to babysit, and a monthly invoice you keep forgetting. Cmail throws all of that away. The whole ecosystem runs inside the Cloudflare account you already own: incoming mail arrives through **Email Routing**, everything is stored in **D1** (SQLite at the edge), and the entire interface is served by a single **Worker**. No server, no invoice, no rented panel.

What you get instead is a personal space you genuinely own — the domain, the data, the keys. Delete it whenever you like, move it whenever you like. That is the whole point.

And because a mailbox alone is never enough, Cmail behaves like an **ecosystem** rather than an inbox: burner addresses for signups, permanent boxes for real work, a colored note under any message, a built-in 2FA vault, and outgoing mail from your own domain — all inside one calm, glassy panel.

### What's new in 2.0 — installation became one file and one binding

- **Everything lives inside `worker.js`.** Pages, styles, scripts, fonts and icons are embedded in that single file. No more "upload the UI folder", no "Attach assets" step — just **Edit Code + one binding**.
- **One-click table setup.** The setup screen now has a **"Create tables automatically"** button: one press builds all 11 tables and 14 indexes. No SQL console needed — and if you ever prefer the manual way, [`schema.sql`](schema.sql) is a single idempotent file you can paste as often as you like.
- **Goodbye, internal server error.** If the D1 binding is missing or the tables are not created yet, the Worker answers with a calm **bilingual guide page** that says exactly which step is left — never a raw error.
- **A leaner database.** New indexes tuned for the real query paths (inbox lists, unread counts, cron cleanups) plus [`migrations/0004_performance_indexes.sql`](migrations/0004_performance_indexes.sql) for existing installs.

### Who is it for?

- **Anyone tired of spam** — instead of handing your real address to every website, mint a one-hour address for each signup and keep your real inbox spotless.
- **Developers and testers** — spin up dozens of test inboxes, catch system emails, try address variants, and let them expire when you are done.
- **Privacy-minded people** — no analytics, no third-party scripts, no CDN calls; everything lives in your account, under your keys.
- **Domain owners** — turn the domains already sitting on your Cloudflare into a complete mail ecosystem. Every domain, unlimited addresses.
- **Anyone who wants their tools to actually belong to them** — set it up once, own it forever.

### Everything it can do

| | |
|---|---|
| 📬 **Temporary + permanent inboxes** | Disposable addresses with a live countdown and adjustable TTL, and permanent ones that are simply yours forever. |
| 🌐 **Unlimited domains** | Attach every domain on your Cloudflare account — one Worker receives them all, each with a live health chip. |
| 🗒️ **Notes on emails** | A colored personal note under any message — order numbers, tracking links, anything. Search finds it instantly. |
| 👤 **Every inbox is an account** | Each mailbox behaves like a standalone account: its mail, its private notes and its own 2FA codes stay inside that account only. Add one from the account bar like adding a fresh identity. |
| 🔐 **2FA vault** | A built-in authenticator: live 6-digit codes with a countdown ring, encrypted at rest with AES-256-GCM, 77 built-in marks, folders, and per-inbox binding. |
| 🛡️ **Account 2FA** | Signing in itself can be protected with TOTP. |
| 📤 **Outgoing mail** | Connect Brevo or Resend with one API key and send from your own domain. |
| ➡️ **Forwarding** | Mirror copies of any inbox to an address you already check. |
| ⌘ **Command palette** | Press <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> anywhere: jump to anything, run actions, search mail live as you type. |
| ⌨️ **Keyboard-first** | `j`/`k` to move, `Enter` to open, `x` to select, `s` to star — the full map lives inside the app. |
| 🧹 **Auto-cleanup** | An hourly cron expires temporary inboxes and purges old mail on its own. |
| 🌙 **Liquid-glass UI** | Dark & Daylight themes, adjustable glass transparency, 13 named color moods, Persian (RTL) + English. |
| 📱 **Truly responsive** | From a 320px phone to a 1920px desktop — panes fold into drawers and bottom sheets. |
| 🔒 **Your data, your rules** | Your D1, your keys. Nobody else holds your mail. |

### A look inside

<div align="center">

| Inbox | Reading RTL mail |
|---|---|
| <img src="docs/screenshot-inbox.png" width="440" alt="inbox"> | <img src="docs/screenshot-reader.png" width="440" alt="reader"> |

| ⌘K palette | Live 2FA vault |
|---|---|
| <img src="docs/screenshot-cmdk.png" width="440" alt="cmdk"> | <img src="docs/screenshot-vault.png" width="440" alt="vault"> |

</div>

### Installation — three ways

> Prerequisites: just a **Cloudflare account** (the free plan is plenty). For the terminal routes: Node.js 18+.

### ⬇️ Ready-made downloads — no clone needed

- **Prebuilt [`worker.js`](https://github.com/Erfan-8910/Cmail/releases/download/v2.0.0/worker.js)** — the entire application in one file (~1.1 MB). This is all Route 2 needs.
- **Full package v2.0.0:** [`CMail-v2.0.0.zip`](https://github.com/Erfan-8910/Cmail/releases/download/v2.0.0/CMail-v2.0.0.zip) — sources, `schema.sql`, migrations and scripts. All versions: [Releases](https://github.com/Erfan-8910/Cmail/releases)

#### Route 1 — one command (terminal)

```bash
git clone https://github.com/Erfan-8910/CMail.git
cd CMail
bash deploy.sh
```

The installer handles everything: creates the D1 database, applies the schema, generates a strong random `APP_SECRET`, deploys the Worker, and prints your panel URL.

#### Route 2 — fully graphical, on dash.cloudflare.com, with zero commands

Four steps. No SQL, no folder uploads — only your browser and the Cloudflare dashboard:

**1) Create the database**
- Sign in to [dash.cloudflare.com](https://dash.cloudflare.com) ← **Storage & Databases ← D1 SQL Database ← Create**
- Name it `cmail-db` and create it. That's it — creating tables is Cmail's own job now.

**2) Create the Worker and paste the code**
- **Workers & Pages ← Create ← Workers ← Create Worker**
- Name it `cmail` and **Deploy** once with the default code.
- Click **Edit code**, delete the default code, paste the full content of [`worker.js`](worker.js) (grab it straight from the [downloads](https://github.com/Erfan-8910/Cmail/releases/download/v2.0.0/worker.js)) and **Deploy**.

**3) The only binding you need: D1**
- Back on the Worker: **Settings ← Bindings ← Add**
- Type **D1 database** ← variable name: `DB` ← database: `cmail-db` ← Save / Deploy.
- (Optional but recommended) also add a **Secret**: name `APP_SECRET` ← value: a long random string. This is the app's internal encryption key — create it once, never change it.

**4) Schedule the cleanup**
- **Settings ← Trigger Events ← Cron Triggers ← Add** and enter: `17 * * * *`

**5) Done!** Open `https://cmail.<your-subdomain>.workers.dev`:
- With the binding in place you will see a single button — **"Create tables automatically"**. Press it once and every table is built (if something is missing, the same page tells you exactly which step slipped).
- Then it asks you to **choose a username and password**, and walks you through the domain and the outgoing-mail service with step-by-step guides.

> 💡 Shortcut: on **Workers & Pages ← Create** you can connect your GitHub fork instead (Connect to Git) and let Cloudflare build automatically. Replace `REPLACE_WITH_D1_ID` in `wrangler.jsonc` with the real database id first.

#### Route 3 — terminal, step by step

<details>
<summary><b>For terminal people</b> (open)</summary>

```bash
git clone https://github.com/Erfan-8910/CMail.git
cd CMail
npm install
npx wrangler login

npx wrangler d1 create cmail-db
#   paste the returned database_id into wrangler.jsonc (REPLACE_WITH_D1_ID)
npx wrangler d1 migrations apply cmail-db --remote
npx wrangler secret put APP_SECRET     # a long random string
npx wrangler deploy
```

The CLI path applies tables as migrations (`0001`–`0004`); to build everything in one shot instead: `npx wrangler d1 execute cmail-db --remote --file=schema.sql`.

Then in the dashboard: your domain ← **Email ← Email Routing** ← enable it ← **Catch-all address ← Action: Send to Worker ← cmail**.

</details>

#### Manual tables, the modern way (if ever needed)

<details>
<summary><b>Creating tables by hand with one file</b> (open)</summary>

If you ever need to build the schema outside the app, there is exactly one file: [`schema.sql`](schema.sql). It carries:

- the final shape of all 11 tables (notes, folders and vault-mark columns included);
- full idempotency — every statement is `IF NOT EXISTS`, so running it twice never errors;
- the performance indexes for the real query paths.

Run it from the D1 **Console** tab in the dashboard (paste → Execute) or from a terminal:

```bash
npx wrangler d1 execute cmail-db --remote --file=schema.sql
```

For older installs that only ever ran `0001`, either apply migrations `0002`/`0003` in order or simply press the one-click button inside the app — its healing statements add any missing columns without errors.

</details>

### Receiving mail: domains & Email Routing

Your domain must use Cloudflare DNS (free plan is fine); a dedicated subdomain like `mail.yourdomain.com` works great. Add the domain in Cmail's **Domains** panel — every domain now carries a live health chip that tells you at a glance whether the connection is actually receiving mail. Enabling Email Routing makes Cloudflare add these records for you:

| Record | Value | Notes |
|---|---|---|
| MX | `route1.mx.cloudflare.net` (priority 10) | automatic |
| MX | `route2.mx.cloudflare.net` (priority 20) | automatic |
| MX | `route3.mx.cloudflare.net` (priority 30) | automatic |
| TXT (SPF) | `v=spf1 include:_spf.mx.cloudflare.net ~all` | automatic |

The final and most important step: **Email Routing ← Routing rules ← Catch-all address ← Action: Send to Worker ← cmail**. From that moment **every** address on your domain lands in Cmail — and with catch-all auto-create, unknown recipients instantly become one-hour inboxes. That is your disposable-mail machine, always on.

### Sending mail (optional, but worth it)

Cmail sends through **Brevo** (300 mails/day free) or **Resend** (100/day free): create an account on the provider, verify your sending domain, then in Cmail go to **Settings ← Outgoing mail**, pick the provider, paste the key, set the sender address, and press Test. The API key is stored only in your own D1 — it never leaves your Cloudflare.

### Sign-in, access & your credentials

The panel is **single-user**; there is no registration and no second account. On the very first visit you choose a **username and password**, and from then on they are the only key. If you prefer not to type the username every time, switch **Username at sign-in** off in **Settings ← Security** — from then on the password alone is enough.

Security is taken seriously: passwords are hashed with PBKDF2-SHA256 (100k iterations), sessions ride on httpOnly cookies, the account itself supports TOTP two-factor, and brute-force attempts are rate-limited per IP and per route.

### 🔑 If you lose your password or username

No hunting for docs — **the recovery guide lives right on the sign-in page**: open "Help & account recovery" under the login form and copy the ready SQL statements:

1. Open [dash.cloudflare.com](https://dash.cloudflare.com) ← **Storage & Databases ← D1 ← cmail-db** ← the **Console** tab.
2. Find your **username**:

```sql
SELECT username FROM users;
```

3. **Reset the password** to the temporary value `Recover-Cmail-2026`:

```sql
UPDATE users SET password_hash = 'pbkdf2$100000$Y21haWwtcmVjb3Zlci1zYWx0MQ==$lvVylyVdxsS9Ji19drxw9ko72vDhlyHCDf5dSIC9Z/c=' WHERE role = 'admin';
```

4. Sign in with your username and `Recover-Cmail-2026`, then **immediately** change the password in Settings ← Security. No mail is touched — the statement only replaces the password.

> ⚠️ **Never run `DELETE FROM users`** — deleting the user cascades and wipes all of their inboxes and mail. The UPDATE above is all you need, and change the temporary password right away.

### Everyday use

- **Create an inbox:** pick a domain, type any local part (or hit Random), choose its lifetime — 1 hour, 24 hours, or permanent. Temporary ones show a live countdown and can be extended.
- **Take notes:** open any mail and write into the personal note — five colors, auto-saved, searchable.
- **⌘K:** the palette jumps between pages, runs actions and searches your mail live while you type.
- **The vault:** add codes by name in the 2FA Vault — paste an `otpauth://` secret or import a QR, pick one of the 77 built-in marks, organize into folders. Codes refresh every 30 seconds and copy with one tap.
- **Shortcuts:** `/` search, `j`/`k` move, `Enter` open, `x` select, `s` star, `Esc` back — the full map lives in the Guide.
- **Make it yours:** Dark/Daylight theme, glass transparency, 13 named color moods, and Persian/English — all in Settings.

### 🔧 Troubleshooting

| Symptom | Meaning | Fix |
|---|---|---|
| Bilingual guide page titled "Database binding is missing" | The D1 binding named `DB` is not set | Installation step 3: Settings ← Bindings ← D1 ← variable `DB` |
| Guide page titled "Tables are not created yet" | Binding works, tables don't exist | Open the home page and press "Create tables automatically" |
| Mail never arrives | Usually the catch-all | Dashboard ← domain ← Email Routing ← Catch-all ← Send to Worker ← `cmail`; the domain's health chip in-app should turn green |
| Outgoing mail fails | Key/sender | Settings ← Outgoing mail ← Test; the sender domain must be verified on the provider |
| A raw Worker error (`1101`) | Should not happen | Every error is converted into the guide page; if you ever see a raw one, the text inside the page is enough to report it — `npx wrangler tail` gives live logs |
| The page does not load at all | Dashboard/service issue | Check [cloudflarestatus.com](https://www.cloudflarestatus.com) |

### FAQ

<details>
<summary><b>How do I update Cmail?</b></summary>

Two paths. If you installed via **Route 2**, just paste the new `worker.js` into Edit Code and Deploy — the database structure is repaired by the "Create tables automatically" button on the setup screen (it only adds missing columns; it never touches your data). If you installed via **Route 1/3**: `git pull` and `npx wrangler deploy` (migrations apply with `npx wrangler d1 migrations apply cmail-db --remote`).
</details>

<details>
<summary><b>Can I use several domains?</b></summary>

Yes — enable each domain on Cloudflare, add it under Domains, point its catch-all to the worker. Inboxes across all domains work instantly.
</details>

<details>
<summary><b>Where does my data live? Can I back it up?</b></summary>

Everything is in your single D1 database. You can export a full SQL snapshot from the dashboard at any time — that is your backup.
</details>

<details>
<summary><b>worker.js is large — is that a problem?</b></summary>

No. It is ~1.1 MB because the entire interface (including logos and fonts) is embedded; after the gzip compression Cloudflare applies automatically it shrinks dramatically and sits comfortably inside the free-plan limits. In exchange there are no separate files and no extra bindings to configure.
</details>

## Under the hood

```
                     ┌──────────────────────────────────────────┐
                     │               Cloudflare                  │
 incoming mail       │                                           │
 SMTP ──────────►  Email Routing (MX)                            │
                     │        │ catch-all                        │
                     │        ▼                                  │
 browser ────────►  Worker ── serves embedded UI (single file)   │
                     │   │  │                                    │
                     │   │  └── Brevo / Resend ──► outgoing mail │
                     │   ▼                                       │
                     │  D1 (SQLite) — mail · inboxes · account   │
                     │               · notes · TOTP · settings   │
                     └──────────────────────────────────────────┘
```

One Worker serves the UI, the API, the incoming-mail handler and the hourly cleanup cron. One D1 database holds everything. That is the whole system — and since 2.0 the UI itself is part of the Worker bundle, so deployments are atomic: paste one file, and interface and backend always match.

**Database map** — what each table owns:

| Table | Purpose |
|---|---|
| `users` | The admin account, PBKDF2 password hash, optional TOTP secret (sealed) |
| `sessions` | Login sessions (token, expiry, UA/IP for the session list) |
| `domains` | Connected domains, catch-all switch, activity |
| `addresses` | Inboxes — permanent or temporary (with TTL), optional forwarding, per-inbox notes |
| `emails` | Full messages (text + HTML), read/star flags, retention |
| `attachments` | Binary attachments stored base64 inside the mail row |
| `email_notes` | Colored sticky notes attached to messages |
| `totp_entries` | 2FA keys — AES-256-GCM sealed, optional mark, optional inbox binding, folders |
| `totp_folders` | User-managed vault folders |
| `settings` | App configuration (sending provider, login mode, app secret) |
| `auth_attempts` | Rate-limit counters per IP and route |

**Request lifecycle highlights**

- `GET /` and `/assets/*` — answered straight from the bundle with ETags; nothing external is fetched, ever (the CSP only allows `self`).
- `POST /api/setup/init` — runs the embedded schema statements in order; refuses once an admin exists, safe to repeat otherwise.
- `POST` to the Worker (Email Routing) — parses MIME, stores mail, auto-creates unknown catch-all inboxes as temporary ones.
- `scheduled` (cron `17 * * * *`) — expires temporary inboxes, prunes old mail and stale sessions.

## License

MIT © [Erfan-8910](https://github.com/Erfan-8910)

---

<div align="center">

**Cmail** — صندوق ایمیلت، قوانینش را هم خودت می‌نویسی. 🌿

*Build it. Own it. Never pay rent for an inbox again.* ✨

</div>

