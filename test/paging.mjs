/* Paging between bags, and pin clustering on the café map. */
import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const ME = '00000000-0000-4000-8000-000000000000';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const fails = [];
const check = (name, ok, got) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) fails.push(name);
};

const bean = (i, name) => ({
  id: 'b' + i, user_id: ME, name, roaster: 'R', origin: 'Kenya',
  brew_method: 'Espresso', flavor_notes: [],
  ratings: { aromatics: 3, acidity: 3, sweetness: 3, aftertaste: 3, body: 3 },
  overall: 4, notes: '', image_url: '', deleted: false,
  // newest first, so the list order is b3, b2, b1
  created_at: `2026-0${i}-01T00:00:00.000Z`, updated_at: '2026-01-01T00:00:00.000Z',
});

const cafe = (i, lat, lng) => ({
  id: 'c' + i, user_id: ME, name: 'Cafe ' + i, address: '', lat, lng,
  rating: 4, notes: '', visited_on: '2026-01-01', deleted: false,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
});

const server = {
  beans: [bean(1, 'Alpha'), bean(2, 'Beta'), bean(3, 'Gamma')],
  // four within a few hundred metres, one far away
  cafes: [
    cafe(1, 40.7128, -74.0060), cafe(2, 40.7131, -74.0063),
    cafe(3, 40.7126, -74.0057), cafe(4, 40.7129, -74.0061),
    cafe(5, 40.7580, -73.9855),
  ],
  profiles: [{ user_id: ME, display_name: 'Norm', share_log: false, approved: true, is_admin: false,
               created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }],
};

async function open(hash) {
  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('pageerror:', e.message); fails.push('pageerror'); });
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
    if (url.pathname.startsWith('/storage/v1/')) return json({ Key: 'ok' });
    const table = url.pathname.replace('/rest/v1/', '');
    return req.method() === 'GET' ? json(server[table] || []) : json([], 201);
  });
  await page.goto(base + hash, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  return { ctx, page };
}

/* ---- paging through bags ------------------------------------------- */
let { ctx, page } = await open('#/bean/b3');
const title = () => page.$eval('.bean-head h2', e => e.textContent.trim());
const pos = () => page.$eval('.pager .pos', e => e.textContent.trim()).catch(() => '');

check('the pager shows where you are', (await pos()) === '1 of 3', await pos());

await page.click('[data-next]');
await page.waitForTimeout(1500);
check('next moves along the list', (await title()) === 'Beta', await title());
check('and the position follows', (await pos()) === '2 of 3', await pos());

await page.click('[data-next]');
await page.waitForTimeout(1500);
check('next again', (await title()) === 'Alpha', await title());

// the whole point of "cycle": the end wraps to the start
await page.click('[data-next]');
await page.waitForTimeout(1500);
check('next from the last wraps to the first', (await title()) === 'Gamma', await title());

await page.click('[data-prev]');
await page.waitForTimeout(1500);
check('previous from the first wraps to the last', (await title()) === 'Alpha', await title());

await page.keyboard.press('ArrowRight');
await page.waitForTimeout(1500);
check('the arrow keys work too', (await title()) === 'Gamma', await title());

/* Paging replaces rather than pushes, so Back returns to the list instead
   of retracing every bag you flicked through. */
await page.goBack();
await page.waitForTimeout(1500);
check('Back leaves the bags, not one step along them',
  !/#\/bean\//.test(page.url()), page.url());
await ctx.close();

/* ---- a single bag has nothing to page through ---------------------- */
const keep = server.beans;
server.beans = [bean(1, 'Only One')];
({ ctx, page } = await open('#/bean/b1'));
check('no pager when there is only one bag', !(await page.$('.pager')), 'pager shown');
await ctx.close();
server.beans = keep;

/* ---- clustering ----------------------------------------------------- */
({ ctx, page } = await open('#/cafes'));

const counts = () => page.evaluate(() => ({
  pins: document.querySelectorAll('#map .pin').length,
  clusters: [...document.querySelectorAll('#map .pin-cluster')].map(e => Number(e.textContent)),
}));

// zoomed out to fit all five, the four neighbours must merge
await page.evaluate(() => window.__brewlogMap?.setZoom?.(11));
await page.waitForTimeout(1200);
let c = await counts();
check('nearby pins merge into one cluster',
  c.clusters.includes(4) && c.pins === 1, c);

/* Partway in, the closest pair is still within the merge radius — two of
   these are 14 m apart, which is only ~31 px at zoom 18. That is the
   behaviour we want, so assert it rather than the naive "all separate". */
await page.evaluate(() => window.__brewlogMap?.setView?.([40.7128, -74.0060], 18));
await page.waitForTimeout(1500);
c = await counts();
check('zooming in breaks the cluster up as the pins separate',
  c.pins > 1 && (c.clusters.length === 0 || Math.max(...c.clusters) < 4), c);

// all the way in, nothing is close enough to merge
await page.evaluate(() => window.__brewlogMap?.setView?.([40.7128, -74.0060], 20));
await page.waitForTimeout(1500);
c = await counts();
check('fully zoomed in, every pin stands alone', c.clusters.length === 0 && c.pins >= 4, c);

// and back out
await page.evaluate(() => window.__brewlogMap?.setZoom?.(11));
await page.waitForTimeout(1200);
c = await counts();
check('zooming back out merges them again', c.clusters.includes(4), c);

// tapping a cluster should zoom toward it
const before = await page.evaluate(() => window.__brewlogMap.getZoom());
await page.click('#map .pin-cluster');
await page.waitForTimeout(1600);
const after = await page.evaluate(() => window.__brewlogMap.getZoom());
check('tapping a cluster zooms in', after > before, { before, after });

await ctx.close();
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall good');
await browser.close();
process.exit(fails.length ? 1 : 0);
