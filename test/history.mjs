/* After a mutation (save or delete) the screen you left must not be in the
   back stack. Regression for: "edit a bean, hit back, you're in the editor". */
import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
const page = await ctx.newPage();
const errs = [];
await page.addInitScript(() => {
  try {
    localStorage.setItem('brewlog.auth.session', JSON.stringify({
      access_token: 'test-token', refresh_token: 'r',
      expires_at: Date.now() + 86400000,
      user: { id: '00000000-0000-4000-8000-000000000000', email: 'test@example.com' },
    }));
  } catch {}
});
page.on('pageerror', e => errs.push('pageerror: ' + e.message));

const fails = [];
const check = (name, ok, got) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${got})`}`);
  if (!ok) fails.push(name);
};

await page.goto(base + '#/settings', { waitUntil: 'networkidle' });
await page.click('[data-seed]');
await page.waitForTimeout(7000);

await page.goto(base + '#/beans', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const id = await page.$eval('[data-go^="#/bean/"]', el => el.dataset.go.split('/').pop());

/* --- save from the editor ------------------------------------------- */
// walk in the way a user does: list -> detail -> edit
await page.click(`[data-go="#/bean/${id}"]`);
await page.waitForTimeout(900);
await page.click('[data-edit]');
await page.waitForTimeout(2000);
check('landed in editor', /\/edit$/.test(page.url()), page.url());

await page.click('[data-save]');
await page.waitForTimeout(2500);
const afterSave = page.url();
check('save leaves the editor', !/\/edit$/.test(afterSave), afterSave);

await page.goBack();
await page.waitForTimeout(1200);
const backFromSave = page.url();
check('back after save does not return to the editor', !/\/edit$/.test(backFromSave), backFromSave);

/* --- delete from the detail screen ---------------------------------- */
// fresh load so the stack is [beans], then walk in by tapping the card
await page.goto(`${base}#/beans`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const delId = await page.$eval('[data-go^="#/bean/"]', el => el.dataset.go.split('/').pop());
await page.click(`[data-go="#/bean/${delId}"]`);
await page.waitForTimeout(1200);
await page.click('[data-del]');
await page.waitForTimeout(500);
await page.click('[data-yes]');
await page.waitForTimeout(2500);
check('delete lands on the list', /#\/beans$/.test(page.url()), page.url());

await page.goBack();
await page.waitForTimeout(1200);
const backFromDelete = page.url();
check('back after delete does not return to the deleted bean',
  !new RegExp(`#/bean/${delId}$`).test(backFromDelete), backFromDelete);

console.log('\nerrors:', errs.length ? errs.join('\n') : 'none');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall good');
await browser.close();
process.exit(fails.length || errs.length ? 1 : 0);
