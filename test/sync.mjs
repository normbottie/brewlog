/* Cross-device sync. Supabase is faked at the network layer so we can play
   the part of "the other device" and change what the server holds between
   loads. Regressions covered:
     - a re-shot photo kept showing the old image on the second device
     - rows shared by a member who opted in later never arrived, because the
       incremental pull watermark had already passed their updated_at
     - nothing re-synced when the installed app was resumed  */
import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const ME = '00000000-0000-4000-8000-000000000000';
const THEM = '11111111-1111-4111-8111-111111111111';

// 2x2 PNGs, one solid red, one solid blue — distinguishable from a pixel
const RED = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFUlEQVR4nGP8z4AKmBhIFRhVMKoAAI5QAR9Qm0MgAAAAAElFTkSuQmCC', 'base64');
const BLUE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFUlEQVR4nGNkYPjPgAqYGEgVGFUwqgAAjbABI+8YlwUAAAAASUVORK5CYII=', 'base64');

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

/* ---- the fake server, mutable between page loads ------------------- */
const server = {
  beans: [{
    id: 'bean-mine', user_id: ME, name: 'Kenya Nyeri', roaster: 'Test Roasters',
    origin: 'Kenya', brew_method: 'Espresso', flavor_notes: [],
    ratings: { aromatics: 3, acidity: 3, sweetness: 3, aftertaste: 3, body: 3 },
    overall: 4, notes: '', deleted: false,
    image_url: 'https://uszcbsovcdzzfxqtzazb.supabase.co/storage/v1/object/public/bag-images/x.jpg?v=one',
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  }],
  cafes: [],
  profiles: [{ user_id: ME, display_name: 'Norm', share_log: false, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }],
  image: RED,
};
let restGets = 0;

await page.addInitScript((me) => {
  try {
    localStorage.setItem('brewlog.auth.session', JSON.stringify({
      access_token: 'test-token', refresh_token: 'r',
      expires_at: Date.now() + 86400000,
      user: { id: me, email: 'test@example.com' },
    }));
  } catch {}
}, ME);

await page.route('**/basemaps.cartocdn.com/**', r => r.abort());

await page.route('**/*.supabase.co/**', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(body),
  });

  if (url.pathname.startsWith('/auth/v1/')) return json({ id: ME, email: 'test@example.com' });

  if (url.pathname.startsWith('/storage/v1/object/public/')) {
    return route.fulfill({ contentType: 'image/png', body: server.image });
  }
  if (url.pathname.startsWith('/storage/v1/object/')) return json({ Key: 'ok' });

  const table = url.pathname.replace('/rest/v1/', '');
  if (req.method() === 'GET') {
    restGets++;
    const since = (url.searchParams.get('updated_at') || '').replace(/^gte\./, '');
    const rows = (server[table] || [])
      .filter(r => !since || (r.updated_at || '') >= since);
    return json(rows);
  }
  return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
});

/** Average colour of the first bean card's image, as [r,g,b]. */
const cardColor = () => page.evaluate(() => new Promise((resolve) => {
  const img = document.querySelector('.bean-card img.shot');
  if (!img || !img.src || img.src.startsWith('data:')) return resolve(null);
  const done = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    resolve([d[0], d[1], d[2]]);
  };
  if (img.complete && img.naturalWidth) done();
  else img.onload = done;
}));

const isRed = (c) => c && c[0] > c[2] + 40;
const isBlue = (c) => c && c[2] > c[0] + 40;

/* ---- 1. first device load: the photo arrives ----------------------- */
await page.goto(base + '#/beans', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

check('bean pulled from the server', await page.$$eval('.bean-card', e => e.length) === 1,
  await page.$$eval('.bean-card .name', e => e.map(x => x.textContent.trim())));
check('photo downloaded', isRed(await cardColor()), await cardColor());

/* ---- 2. the other device re-shoots the bag ------------------------- */
// same storage path, new version stamp — this is what our sync writes
server.image = BLUE;
server.beans[0].image_url =
  'https://uszcbsovcdzzfxqtzazb.supabase.co/storage/v1/object/public/bag-images/x.jpg?v=two';
server.beans[0].updated_at = '2026-02-01T00:00:00.000Z';

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
check('re-shot photo replaces the cached one', isBlue(await cardColor()), await cardColor());

/* ---- 3. a member opts into sharing, with older rows ---------------- */
server.profiles.push({
  user_id: THEM, display_name: 'Deb', share_log: true,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
});
server.beans.push({
  id: 'bean-theirs', user_id: THEM, name: 'Their Ethiopia', roaster: 'Deb Roasts',
  origin: 'Ethiopia', brew_method: 'Drip', flavor_notes: [],
  ratings: { aromatics: 3, acidity: 3, sweetness: 3, aftertaste: 3, body: 3 },
  overall: 3, notes: '', deleted: false, image_url: '',
  // deliberately older than the watermark the first sync will have stored
  created_at: '2025-06-01T00:00:00.000Z', updated_at: '2025-06-01T00:00:00.000Z',
});

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
await page.click('[data-sc="all"]').catch(() => {});
await page.waitForTimeout(1500);

const names = await page.$$eval('.bean-card .name', els => els.map(e => e.textContent.trim()));
check('a late sharer\'s older entries still arrive', names.includes('Their Ethiopia'), names);

/* ---- 4. sharing switched back off --------------------------------- */
server.profiles[1].share_log = false;
server.profiles[1].updated_at = '2026-03-01T00:00:00.000Z';
server.beans = server.beans.filter(b => b.user_id !== THEM);   // RLS stops returning them

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(4500);
const after = await page.$$eval('.bean-card .name', els => els.map(e => e.textContent.trim()));
check('their entries are dropped when they stop sharing', !after.includes('Their Ethiopia'), after);

/* ---- 5. resuming the app re-syncs ---------------------------------- */
await page.waitForTimeout(16000);          // clear the resume throttle
const before = restGets;
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(3000);
check('resuming triggers a sync', restGets > before, { before, after: restGets });

console.log('\nerrors:', errs.length ? errs.join('\n') : 'none');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall good');
await browser.close();
process.exit(fails.length || errs.length ? 1 : 0);
