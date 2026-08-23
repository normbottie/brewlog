import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = '/root/brewlog/test/shots';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({
  viewport: { width: 414, height: 896 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  permissions: [],
});
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('brewlog.auth.session', JSON.stringify({
        access_token: 'test-token', refresh_token: 'r',
        expires_at: Date.now() + 86400000,
        user: { id: '00000000-0000-4000-8000-000000000000', email: 'test@example.com' },
      }));
    } catch {}
  });
const page = await ctx.newPage();

page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

const base = 'http://localhost:8899/index.html';

async function shot(name, ms = 900) {
  await page.waitForTimeout(ms);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot:', name);
}

await page.goto(base + '#/beans', { waitUntil: 'networkidle' });
await shot('01-empty-beans');

// seed
await page.goto(base + '#/settings', { waitUntil: 'networkidle' });
await shot('02-settings');
await page.click('[data-seed]');
await page.waitForTimeout(6000);

await page.goto(base + '#/beans');
await page.waitForTimeout(500);
await page.reload({ waitUntil: 'networkidle' });
await shot('03-beans-list', 2200);

const firstId = await page.$eval('[data-go^="#/bean/"]', el => el.dataset.go);
await page.goto(base + firstId, { waitUntil: 'networkidle' });
await shot('04-bean-detail', 1600);
await page.evaluate(() => window.scrollTo(0, 700));
await shot('05-bean-detail-radar', 700);

await page.goto(base + '#/new', { waitUntil: 'networkidle' });
await shot('06-new-bean');
await page.evaluate(() => window.scrollTo(0, 1100));
await shot('07-new-bean-brew', 500);
await page.evaluate(() => window.scrollTo(0, 1900));
await shot('08-new-bean-radar', 500);

await page.goto(base + '#/cafes', { waitUntil: 'networkidle' });
await shot('09-cafes', 3500);

const cafeId = await page.$eval('[data-go^="#/cafe/"]', el => el.dataset.go);
await page.goto(base + cafeId, { waitUntil: 'networkidle' });
await shot('10-cafe-detail', 2500);

await page.goto(base + '#/settings', { waitUntil: 'networkidle' });
await shot('11-settings-full', 900);

console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : 'none');

await browser.close();
