import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));

// 1. signed-out settings shows the sign-in form
await page.goto(base + '#/settings', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
console.log('sign-in form present:', !!(await page.$('[data-signin]')));
console.log('sync message:', await page.$eval('[data-sync-msg]', e => e.textContent.trim()));

// 2. sign-in without Supabase configured explains itself rather than throwing
await page.fill('[data-email]', 'someone@example.com');
await page.click('[data-signin]');
await page.waitForTimeout(600);
console.log('unconfigured message:', await page.$eval('[data-authstatus]', e => e.textContent.trim()));

// 3. a magic-link style callback is consumed and the URL cleaned.
// Two ways in: a cold load, and a hash change while the app is already open.
await page.goto(
  base + '#access_token=fake.token.value&refresh_token=r1&expires_in=3600&token_type=bearer',
  { waitUntil: 'networkidle' }
);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
console.log('hash after callback:', await page.evaluate(() => location.hash));
const stored = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('brewlog.auth.session') || 'null'); } catch { return null; }
});
console.log('session captured:', !!stored?.access_token);

// 4. settings now shows the signed-in state
await page.goto(base + '#/settings', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
console.log('sign-out button present:', !!(await page.$('[data-signout]')));

// 5. an error callback surfaces instead of being swallowed
await page.evaluate(() => {
  location.hash = '#error=access_denied&error_description=Email+link+is+invalid+or+has+expired';
});
await page.waitForTimeout(1200);
const toastText = await page.$eval('.toast', e => e.textContent.trim()).catch(() => '(no toast)');
console.log('expired-link toast:', toastText);

console.log('\nerrors:', errs.length ? errs.join('\n') : 'none');
await browser.close();
