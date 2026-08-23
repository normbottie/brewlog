import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = '/root/brewlog/test/shots';
fs.mkdirSync(OUT, { recursive: true });
const base = 'http://localhost:8899/index.html';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));

await page.goto(base + '#/settings', { waitUntil: 'networkidle' });
await page.click('[data-seed]');
await page.waitForTimeout(7000);

await page.goto(base + '#/beans', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const id = await page.$eval('[data-go^="#/bean/"]', el => el.dataset.go.split('/').pop());

await page.goto(`${base}#/bean/${id}/edit`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const variants = await page.$$eval('[data-v]', els => els.map(e => e.dataset.v));
const status = await page.$eval('[data-imgstatus]', e => e.textContent.trim());
console.log('variants shown:', variants);
console.log('status:', status);

await page.screenshot({ path: `${OUT}/edit-before.png` });

// change backdrop -> the photo variant should rebuild
await page.click('[data-bd="espresso"]');
await page.waitForTimeout(3000);
const status2 = await page.$eval('[data-imgstatus]', e => e.textContent.trim());
const pressed = await page.$eval('[data-bd="espresso"]', e => e.getAttribute('aria-pressed'));
console.log('after backdrop change -> pressed:', pressed, '| status:', status2);

const thumbCount = await page.$$eval('[data-v] img', els => els.length);
console.log('thumbnails with images:', thumbCount);
await page.screenshot({ path: `${OUT}/edit-after.png` });

console.log('\nerrors:', errs.length ? errs.join('\n') : 'none');
await browser.close();
