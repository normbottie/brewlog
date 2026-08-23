import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const ME    = '00000000-0000-4000-8000-000000000001';
const FRIEND= '00000000-0000-4000-8000-000000000002';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 414, height: 896 } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));

await page.addInitScript(([me, friend]) => {
  try {
    localStorage.setItem('brewlog.auth.session', JSON.stringify({
      access_token: 't', refresh_token: 'r', expires_at: Date.now() + 864e5,
      user: { id: me, email: 'me@example.com' },
    }));
    localStorage.setItem('brewlog.scope.beans', '1');
    localStorage.setItem('brewlog.scope.cafes', '1');
  } catch {}
  window.__seed = { me, friend };
}, [ME, FRIEND]);

await page.goto(base + '#/beans', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);

// seed: my bean, friend's bean, friend's cafe, and both profiles
await page.evaluate(async () => {
  const { me, friend } = window.__seed;
  const { idb, metaSet } = await import('./js/idb.js');
  const now = new Date().toISOString();
  await idb.put('beans', { id: 'b-mine', user_id: me, name: 'My Kenya', roaster: 'Onyx',
    ratings: { aromatics: 4, acidity: 4, sweetness: 3, aftertaste: 3, body: 3 }, overall: 4,
    flavor_notes: [], created_at: now, updated_at: now, deleted: false });
  await idb.put('beans', { id: 'b-theirs', user_id: friend, name: 'Their Ethiopia', roaster: 'Sey',
    ratings: { aromatics: 5, acidity: 4, sweetness: 4, aftertaste: 4, body: 2 }, overall: 5,
    flavor_notes: [], created_at: now, updated_at: now, deleted: false });
  await idb.put('cafes', { id: 'c-theirs', user_id: friend, name: 'Their Cafe',
    address: '1 Main St', lat: 40.7, lng: -73.9, rating: 4, notes: 'nice',
    created_at: now, updated_at: now, deleted: false });
  await metaSet('profiles', [
    { user_id: me, display_name: 'Norm', share_log: true, _slot: -1 },
    { user_id: friend, display_name: 'Deb', share_log: true, _slot: 0 },
  ]);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const names = await page.$$eval('.bean-card .name', els => els.map(e => e.textContent.trim()));
console.log('Everyone shows:', names);
console.log('shared card marked:', await page.$$eval('.bean-card.shared .name', e => e.map(x=>x.textContent.trim())));
console.log('owner badge text:', await page.$eval('.bean-card.shared .owner-name', e => e.textContent.trim()).catch(()=>'(none)'));
console.log('owner color:', await page.$eval('.bean-card.shared .owner-dot', e => getComputedStyle(e).backgroundColor));

// switch to Mine
await page.click('[data-sc="mine"]');
await page.waitForTimeout(900);
console.log('Mine shows:', await page.$$eval('.bean-card .name', els => els.map(e => e.textContent.trim())));

// friend's bean detail must be read-only
await page.goto(base + '#/bean/b-theirs', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
console.log('edit button on shared bean:', !!(await page.$('[data-edit]')));
console.log('delete button on shared bean:', !!(await page.$('[data-del]')));
console.log('read-only note:', !!(await page.$('.read-only-note')));

// direct edit URL must bounce
await page.goto(base + '#/bean/b-theirs/edit', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
console.log('edit URL redirected to:', await page.evaluate(() => location.hash));

// the store must refuse to write a foreign row
console.log('save foreign rejected:', await page.evaluate(async () => {
  const s = await import('./js/store.js');
  try { await s.saveBean(await s.getBean('b-theirs')); return false; }
  catch (e) { return e.message; }
}));

// friend's cafe read-only
await page.goto(base + '#/cafe/c-theirs', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
console.log('cafe save button:', !!(await page.$('[data-save]')));
console.log('cafe notes readonly:', await page.$eval('[data-notes]', e => e.readOnly));

await page.goto(base + '#/beans', { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await page.screenshot({ path: 'test/shots/sharing-beans.png' });
await page.goto(base + '#/settings', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.screenshot({ path: 'test/shots/sharing-settings.png' });

console.log('\nerrors:', errs.length ? errs.join('\n') : 'none');
await browser.close();
