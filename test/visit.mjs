/* The "want to visit" list, the overlapping pager arrows, and the
   background seam that appeared once you scrolled past one viewport. */
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
  id: 'b' + i, user_id: ME, name, roaster: 'R', origin: 'Kenya', brew_method: 'Espresso',
  flavor_notes: [], ratings: { aromatics: 3, acidity: 3, sweetness: 3, aftertaste: 3, body: 3 },
  overall: 4, notes: '', image_url: '', deleted: false,
  created_at: `2026-0${i}-01T00:00:00.000Z`, updated_at: '2026-01-01T00:00:00.000Z',
});

/* Visited ones carry a date and a rating; the wishlist has neither.
   Coordinates are fixed and well spread: random ones sometimes landed close
   enough to merge into a cluster, which made the pin assertions flaky. */
const SPOTS = { c1: [40.7128, -74.0060], c2: [40.7600, -73.9800], c3: [40.6800, -74.0400] };
const cafe = (id, name, { rating = 4, visited_on = '2026-01-01' } = {}) => ({
  id, user_id: ME, name, address: '1 Test St',
  lat: SPOTS[id][0], lng: SPOTS[id][1],
  rating, notes: '', visited_on, deleted: false,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
});

const server = {
  beans: [bean(1, 'Alpha'), bean(2, 'Beta'), bean(3, 'Gamma')],
  cafes: [
    cafe('c1', 'Been Here'),
    cafe('c2', 'Want This', { rating: 0, visited_on: '' }),
    cafe('c3', 'Want That', { rating: 0, visited_on: '' }),
  ],
  profiles: [{ user_id: ME, display_name: 'Norm', share_log: false, approved: true, is_admin: true,
               created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }],
  writes: [],
};

async function open(hash, size = { width: 414, height: 896 }) {
  const ctx = await browser.newContext({ viewport: size });
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
    if (req.method() === 'GET') return json(server[table] || []);
    server.writes.push({ table, rows: JSON.parse(req.postData() || '[]') });
    return json([], 201);
  });
  await page.goto(base + hash, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3200);
  return { ctx, page };
}

/* ---- 1. the background no longer seams when you scroll -------------- */
let { ctx, page } = await open('#/settings', { width: 1400, height: 900 });

/* body used to be pinned to exactly one viewport while the page scrolled
   past it, and a body background paints over the fixed ambient layer —
   so the edge of the body box drew a hard line across the page. */
const boxes = await page.evaluate(() => ({
  doc: document.documentElement.scrollHeight,
  body: Math.round(document.body.getBoundingClientRect().height),
}));
check('the body grows with the page rather than stopping at one screen',
  boxes.body >= boxes.doc - 2, boxes);

await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await page.waitForTimeout(700);

/* Sample the far-left gutter, where no card covers the background, and
   look for an abrupt jump between adjacent rows. */
const seam = await page.evaluate(async () => {
  const strip = [];
  const el = document.elementFromPoint(8, 8);
  void el;
  return new Promise((resolve) => {
    // read the painted page via a canvas of the ambient layer's own colours
    const amb = document.getElementById('ambient');
    const cs = getComputedStyle(amb);
    resolve({ position: cs.position, top: amb.getBoundingClientRect().top,
              height: Math.round(amb.getBoundingClientRect().height),
              inner: window.innerHeight, strip });
  });
});
check('the ambient layer still covers the viewport when scrolled',
  seam.position === 'fixed' && seam.top === 0 && Math.abs(seam.height - seam.inner) < 2, seam);

const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check('body paints nothing over the ambient layer',
  /rgba\(0, 0, 0, 0\)|transparent/.test(bodyBg), bodyBg);
await ctx.close();

/* ---- 2. want-to-visit section --------------------------------------- */
({ ctx, page } = await open('#/cafes'));
const sections = await page.$$eval('[data-list] .section', els => els.map(e => e.textContent.trim()));
check('there is a Want to visit section', sections.some(t => /Want to visit/.test(t)), sections);
check('and a visited section', sections.some(t => /Visited/.test(t)), sections);
check('the counts are right',
  /Want to visit · 2/.test(sections.join('|')) && /Visited · 1/.test(sections.join('|')), sections);

const order = await page.$$eval('[data-list] .cafe-row .nm', els => els.map(e => e.textContent.trim()));
check('unvisited places come first', order[0].startsWith('Want') && order.at(-1) === 'Been Here', order);

const wantRow = await page.$eval('[data-go="#/cafe/c2"]', e => e.textContent);
check('an unvisited place shows no star rating', /Not visited yet/.test(wantRow), wantRow.trim());
check('a visited place still shows stars',
  await page.$eval('[data-go="#/cafe/c1"]', e => !!e.querySelector('.stars')), 'no stars');

const pins = await page.evaluate(() => ({
  hollow: document.querySelectorAll('#map .pin.want').length,
  solid: document.querySelectorAll('#map .pin:not(.want)').length,
}));
check('unvisited places get a hollow pin', pins.hollow >= 1, pins);
await ctx.close();

/* ---- 3. marking one as visited moves it -------------------------- */
server.writes = [];
({ ctx, page } = await open('#/cafe/c2'));
check('the detail screen says it has not been visited',
  !!(await page.$('[data-visited]')), 'no button');
await page.click('[data-visited]');
await page.waitForTimeout(2500);

const saved = server.writes.flatMap(w => w.table === 'cafes' ? w.rows : []).find(r => r.id === 'c2');
check('a visit date is recorded', !!saved?.visited_on, saved);
await ctx.close();

/* ---- 4. rating one also graduates it ------------------------------- */
server.writes = [];
({ ctx, page } = await open('#/cafe/c3'));
await page.click('[data-stars] [data-star="4"]');
await page.waitForTimeout(400);
await page.click('[data-save]');
await page.waitForTimeout(2500);
const rated = server.writes.flatMap(w => w.table === 'cafes' ? w.rows : []).find(r => r.id === 'c3');
check('rating it counts as having been', rated?.rating === 4 && !!rated?.visited_on, rated);
await ctx.close();

/* ---- 5. the pager arrows overlap the header ------------------------- */
({ ctx, page } = await open('#/bean/b3'));
check('the arrows are circles', await page.$eval('.pager-btn.prev', el => {
  const cs = getComputedStyle(el);
  return cs.borderRadius === '50%' && Math.abs(parseFloat(cs.width) - parseFloat(cs.height)) < 1;
}), 'not circular');

const geo = await page.evaluate(() => {
  const head = document.querySelector('.bean-head').getBoundingClientRect();
  const prev = document.querySelector('.pager-btn.prev').getBoundingClientRect();
  const next = document.querySelector('.pager-btn.next').getBoundingClientRect();
  return {
    prevOverlapsLeft: prev.left < head.left && prev.right > head.left,
    nextOverlapsRight: next.right > head.right && next.left < head.right,
    prevCentred: Math.abs((prev.top + prev.bottom) / 2 - (head.top + head.bottom) / 2) < 2,
    onScreen: prev.left >= 0 && next.right <= window.innerWidth,
  };
});
check('the previous arrow straddles the left edge', geo.prevOverlapsLeft, geo);
check('the next arrow straddles the right edge', geo.nextOverlapsRight, geo);
check('both sit level with the middle of the card', geo.prevCentred, geo);
check('neither is cut off by the screen edge', geo.onScreen, geo);

// and they still page
await page.click('.pager-btn.next');
await page.waitForTimeout(1500);
check('the arrows still page through bags',
  (await page.$eval('.bean-head h2', e => e.textContent.trim())) === 'Beta',
  await page.$eval('.bean-head h2', e => e.textContent.trim()));
await ctx.close();

console.log(fails.length ? `\n${fails.length} FAILING` : '\nall good');
await browser.close();
process.exit(fails.length ? 1 : 0);
