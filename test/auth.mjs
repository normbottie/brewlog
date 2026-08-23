import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 414, height: 896 } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));

// 1. signed out -> gate, tab bar hidden, no app content
await page.goto(base + '#/beans', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
console.log('gate shown:', !!(await page.$('[data-send]')));
console.log('code input shown:', !!(await page.$('[data-code]')));
console.log('tabbar hidden:', await page.$eval('#tabbar', e => e.hidden));
console.log('app content leaked:', !!(await page.$('.bean-grid, .search-bar')));

// 2. code validation is local-first
await page.fill('[data-email]', 'norm@example.com');
await page.fill('[data-code]', '123');
await page.click('[data-verify]');
await page.waitForTimeout(500);
console.log('short-code msg:', await page.$eval('[data-status]', e => e.textContent.trim()));

// 3. magic-link callback still signs in and unlocks the app
await page.goto(base + '#access_token=fake.tok&refresh_token=r&expires_in=3600&token_type=bearer',
  { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
console.log('hash after callback:', await page.evaluate(() => location.hash));
console.log('tabbar visible:', await page.$eval('#tabbar', e => !e.hidden));
console.log('beans view rendered:', !!(await page.$('.search-bar')));

// 4. signing out returns to the gate
await page.evaluate(() => localStorage.removeItem('brewlog.auth.session'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
console.log('gate again after signout:', !!(await page.$('[data-send]')));

console.log('\nerrors:', errs.length ? errs.join('\n') : 'none');
await browser.close();
