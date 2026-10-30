// Cmail — seed demo mail into local D1 for E2E testing (node scripts/seed-local.mjs)
import { execSync } from 'node:child_process';

const user = execSync('npx wrangler d1 execute cmail-db --local --command "SELECT id FROM users LIMIT 1" --json', { encoding: 'utf8', cwd: '/home/z/my-project/cmail' });
const uid = JSON.parse(user)[0].results[0].id;

const mails = [
  ['em_t1', 'adr_hello', 'لینوکس‌مگ', 'mag@example.org', 'خلاصه‌ی هفته: هسته ۶٫۱۲ منتشر شد', 'چهل سال پیش اولین نسخه معرفی شد؛ امروز نسخه تازه با پشتیبانی بهتر از سخت‌افزارهای نو رسیده است.', 1792000000000],
  ['em_t2', 'adr_hello', 'Cloudflare Notifications', 'no-reply@notify.example.net', 'Your weekly usage report is ready', 'Here is your weekly summary: 132 requests routed, 0 blocked, storage 4.2MB. Everything looks healthy this week.', 1796400000000],
  ['em_t3', 'adr_shop', 'فروشگاه نمونه', 'orders@shop.example.com', 'سفارش شما ارسال شد', 'بستهٔ شما تحویل پست شد. کد رهگیری: ۱۲۳۴۵۶۷۸. تا دو روز آینده به دستتان می‌رسد.', 1796500000000],
  ['em_t4', 'adr_shop', 'Payment Gateway', 'billing@pay.example.net', 'Receipt #8842 — paid successfully', 'Thank you for your purchase. Amount: $24.00. This is your electronic receipt, keep it for your records.', 1796600000000],
  ['em_t5', 'adr_tmp', 'Welcome Team', 'hello@welcome.example.org', 'به فضای آزمایشی خوش آمدید', 'این یک نامهٔ آزمایشی است تا چیدمان فهرست را روی صفحهٔ کوچک بررسی کنیم.', 1796700000000],
  ['em_t6', 'adr_tmp', 'Security Alerts', 'alerts@example.net', 'New sign-in to your account', 'We noticed a new sign-in from a recognized device. If this was you, no action is needed.', 1796750000000],
];

for (const [id, adr, name, addr, subj, prev, recv] of mails) {
  const sql = `INSERT OR REPLACE INTO emails (id, user_id, address_id, from_name, from_addr, to_addr, subject, preview, text_body, size, is_read, starred, has_note, received_at) VALUES ('${id}', '${uid}', '${adr}', '${name}', '${addr}', 'me@example.com', '${subj.replace(/'/g, "''")}', '${prev.replace(/'/g, "''")}', '${prev.replace(/'/g, "''")}', 1024, 0, 0, 0, ${recv});`;
  execSync(`npx wrangler d1 execute cmail-db --local --json --command "${sql.replace(/"/g, '\\"')}"`, { cwd: '/home/z/my-project/cmail', stdio: 'pipe' });
}
console.log('seeded', mails.length, 'mails for user', uid);
