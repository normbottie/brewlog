/* Bean ↔ café linking, roaster pages, and the share card.

   Everything here is derived rather than stored — a café's bean list, a
   roaster's averages — so the risk is that a link silently points nowhere.
   These checks follow each link in both directions. */
import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const ME = '00000000-0000-4000-8000-000000000000';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFUlEQVR4nGP8z4AKmBhIFRhVMKoAAI5QAR9Qm0MgAAAAAElFTkSuQmCC', 'base64');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));

const fails = [];
const check = (name, ok, got) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) fails.push(name);
};

const iso = (d) => new Date(d).toISOString();
const CAFE = {
  id: 'cafe-sey', user_id: ME, name: 'Sey Coffee', address: '18 Grattan St, Brooklyn',
  lat: 40.7069, lng: -73.9339, rating: 5, notes: 'Bright room.', visited_on: '2026-06-01',
  deleted: false, created_at: iso('2026-01-01'), updated_at: iso('2026-01-01'),
};
const OTHER_CAFE = {
  ...CAFE, id: 'cafe-other', name: 'Abraço', address: '81 E 7th St', rating: 4,
};

const bean = (id, over) => ({
  id, user_id: ME, name: 'Bean ' + id, roaster: 'Onyx Coffee Lab', origin: 'Kenya',
  region: 'Kirinyaga', process: 'Washed', varietal: 'SL28', roast_level: 'Light',
  roast_date: '2026-05-01', price: '24.00', weight_g: '250', brew_method: 'V60',
  grind: '22g in', cafe_id: CAFE.id, flavor_notes: ['blackcurrant', 'grapefruit'],
  ratings: { aromatics: 4, acidity: 5, sweetness: 4, aftertaste: 5, body: 3 },
  overall: 5, notes: 'Bright.', image_url: '', deleted: false,
  created_at: iso('2026-02-01'), updated_at: iso('2026-02-01'), ...over,
});

const BEANS = [
  bean('bean-a', { name: 'Kirinyaga AB', overall: 5 }),
  bean('bean-b', { name: 'Gatomboya', overall: 3, created_at: iso('2026-01-15') }),
  // same roaster, spelled differently and bought somewhere else
  bean('bean-c', {
    name: 'Geometry', roaster: '  onyx coffee lab ', cafe_id: OTHER_CAFE.id,
    overall: 0, origin: 'Ethiopia', process: 'Natural', created_at: iso('2026-01-10'),
  }),
  // a different roaster entirely — must not leak into the roaster page
  bean('bean-d', { name: 'Monarch', roaster: 'Counter Culture', cafe_id: '', overall: 4 }),
];

const server = {
  beans: BEANS,
  cafes: [CAFE, OTHER_CAFE],
  profiles: [{ user_id: ME, display_name: 'Norm', share_log: false, created_at: iso('2026-01-01'), updated_at: iso('2026-01-01') }],
  settings: [],
  upserts: [],
};

await page.addInitScript((me) => {
  try {
    localStorage.setItem('brewlog.auth.session', JSON.stringify({
      access_token: 't', refresh_token: 'r', expires_at: Date.now() + 86400000,
      user: { id: me, email: 'norm@example.com' },
    }));
  } catch {}
}, ME);

await page.route('**/basemaps.cartocdn.com/**', r => r.abort());
await page.route('**/*.supabase.co/**', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.pathname.startsWith('/auth/v1/')) return json({ id: ME, email: 'norm@example.com' });
  if (url.pathname.startsWith('/storage/v1/object/public/')) {
    return route.fulfill({ contentType: 'image/png', body: PNG });
  }
  if (url.pathname.startsWith('/storage/v1/')) return json({ Key: 'ok' });
  const table = url.pathname.replace('/rest/v1/', '');
  if (req.method() === 'GET') return json(server[table] || []);
  server.upserts.push({ table, rows: JSON.parse(req.postData() || '[]') });
  return json([], 201);
});

const go = async (hash) => {
  await page.goto(base + hash, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
};

/* ---- bean → café --------------------------------------------------- */

await go('#/bean/bean-a');
const cafeLink = await page.$('a.cafe-row[href="#/cafe/cafe-sey"]');
check('a bean shows the café it came from', !!cafeLink,
  await page.$$eval('a.cafe-row', els => els.map(e => e.getAttribute('href'))));

await page.click('a.cafe-row[href="#/cafe/cafe-sey"]');
await page.waitForTimeout(2200);
check('following it lands on the café', page.url().includes('#/cafe/cafe-sey'), page.url());

/* ---- café → beans -------------------------------------------------- */

const listed = await page.$$eval('[data-beans] a.cafe-row', els => els.map(e => e.getAttribute('href')));
check('the café lists both bags bought there',
  listed.includes('#/bean/bean-a') && listed.includes('#/bean/bean-b'), listed);
check('and not the bag bought elsewhere', !listed.includes('#/bean/bean-c'), listed);

await go('#/cafe/cafe-other');
const other = await page.$$eval('[data-beans] a.cafe-row', els => els.map(e => e.getAttribute('href')));
check('a different café lists only its own', other.length === 1 && other[0] === '#/bean/bean-c', other);

/* ---- the link survives a round trip through the editor ------------- */

await go('#/bean/bean-a/edit');
const picked = await page.$eval('[data-f="cafe_id"]', el => el.value).catch(() => 'no picker');
check('the editor pre-selects the linked café', picked === CAFE.id, picked);

await page.selectOption('[data-f="cafe_id"]', OTHER_CAFE.id);
await page.click('[data-save]');
await page.waitForTimeout(3000);
check('changing it re-points the bean',
  !!(await page.$(`a.cafe-row[href="#/cafe/${OTHER_CAFE.id}"]`)),
  await page.$$eval('a.cafe-row', els => els.map(e => e.getAttribute('href'))));

const pushedBean = server.upserts.flatMap(u => u.rows).filter(r => r.id === 'bean-a').pop();
check('and the new café id syncs', pushedBean?.cafe_id === OTHER_CAFE.id, pushedBean?.cafe_id);

/* An unlinked bean must push null, not "" — the column is text now, but an
   empty string is not "no café" and would read back as a dangling link. */
await go('#/bean/bean-d/edit');
await page.click('[data-save]');
await page.waitForTimeout(3000);
const pushedD = server.upserts.flatMap(u => u.rows).filter(r => r.id === 'bean-d').pop();
check('no café pushes as null', pushedD && pushedD.cafe_id === null, pushedD?.cafe_id);

/* ---- roaster page -------------------------------------------------- */

await go('#/bean/bean-a');
const roasterHref = await page.$eval('.hero .cap a.roaster', el => el.getAttribute('href')).catch(() => 'none');
check('the roaster name is a link', roasterHref === '#/roaster/onyx%20coffee%20lab', roasterHref);

await page.click('.hero .cap a.roaster');
await page.waitForTimeout(2500);
const bags = await page.$$eval('a.cafe-row', els => els.map(e => e.getAttribute('href')));
check('the roaster page gathers every bag of theirs',
  ['#/bean/bean-a', '#/bean/bean-b', '#/bean/bean-c'].every(h => bags.includes(h)), bags);
check('including one spelled differently', bags.includes('#/bean/bean-c'), bags);
check('and nobody else’s', !bags.includes('#/bean/bean-d'), bags);

const avg = await page.$eval('.stat-row .big', el => el.textContent.trim());
check('the average ignores unrated bags', avg === '4.0', avg);   // (5 + 3) / 2

const heading = await page.$eval('.topbar h1', el => el.textContent.trim());
check('and it is titled with the spelling you used last', heading === 'Onyx Coffee Lab', heading);

await go('#/roaster/nobody%20at%20all');
check('an unknown roaster says so, rather than throwing',
  (await page.textContent('.empty h3').catch(() => '')).includes('Nothing from this roaster'),
  await page.textContent('.view').catch(() => 'no view'));

/* ---- share card ---------------------------------------------------- */

await go('#/bean/bean-a');
await page.click('[data-card]');
await page.waitForTimeout(2500);
const cardSrc = await page.$eval('.sheet-body img', el => el.getAttribute('src')).catch(() => '');
check('the card sheet shows a rendered image', cardSrc.startsWith('blob:'), cardSrc.slice(0, 20));
const dl = await page.$eval('.sheet-body a[download]', el => el.getAttribute('download')).catch(() => '');
check('and offers it as a png download', /\.png$/.test(dl), dl);

const size = await page.evaluate(async () => {
  const src = document.querySelector('.sheet-body img').src;
  const blob = await (await fetch(src)).blob();
  const bmp = await createImageBitmap(blob);
  return { type: blob.type, w: bmp.width, h: bmp.height, bytes: blob.size };
});
check('the png is a 1080×1350 portrait',
  size.type === 'image/png' && size.w === 1080 && size.h === 1350, size);
check('and is not a blank canvas', size.bytes > 20000, size);

console.log('\nerrors:', errs.length ? errs.join('\n') : 'none');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall good');
await browser.close();
process.exit(fails.length || errs.length ? 1 : 0);
