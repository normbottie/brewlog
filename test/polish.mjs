/* Tab bar actually hidden on the gated screens, collapsible settings,
   double-tap zoom, and the style reference sent to Gemini. */
import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const ME = '00000000-0000-4000-8000-000000000000';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFUlEQVR4nGP8z4AKmBhIFRhVMKoAAI5QAR9Qm0MgAAAAAElFTkSuQmCC', 'base64');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const fails = [];
const check = (name, ok, got) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) fails.push(name);
};

const cafe = (i, lat, lng) => ({
  id: 'c' + i, user_id: ME, name: 'Cafe ' + i, address: '', lat, lng,
  rating: 4, notes: '', visited_on: '2026-01-01', deleted: false,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
});

const server = {
  beans: [], cafes: [cafe(1, 40.7128, -74.0060)],
  profiles: [{ user_id: ME, display_name: 'Norm', share_log: false, approved: true, is_admin: false,
               created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }],
};
let geminiBodies = [];

async function open(hash, { signedIn = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('pageerror:', e.message); fails.push('pageerror'); });
  if (signedIn) {
    await page.addInitScript((me) => {
      try {
        localStorage.setItem('brewlog.auth.session', JSON.stringify({
          access_token: 't', refresh_token: 'r', expires_at: Date.now() + 86400000,
          user: { id: me, email: 'norm@example.com' },
        }));
      } catch {}
    }, ME);
  }
  await page.route('**/basemaps.cartocdn.com/**', r => r.abort());
  await page.route('**/*.supabase.co/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.pathname === '/functions/v1/gemini-proxy') {
      const path = url.searchParams.get('path') || '';
      geminiBodies.push({ path, body: JSON.parse(req.postData() || '{}') });
      if (path.startsWith('/v1beta/models?')) return json({ models: [] });
      return json({ candidates: [{ content: { parts: [
        { inline_data: { mime_type: 'image/png', data: PNG.toString('base64') } },
      ] } }] });
    }
    if (url.pathname.startsWith('/auth/v1/')) return json({ id: ME, email: 'norm@example.com' });
    if (url.pathname.startsWith('/storage/v1/')) return json({ Key: 'ok' });
    const table = url.pathname.replace('/rest/v1/', '');
    return req.method() === 'GET' ? json(server[table] || []) : json([], 201);
  });
  await page.goto(base + hash, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  return { ctx, page };
}

/** Is the tab bar actually painted, rather than merely marked hidden? */
const barVisible = (page) => page.evaluate(() => {
  const el = document.getElementById('tabbar');
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0;
});

/* ---- 1. the sign-in screen shows no floating pill ------------------- */
let { ctx, page } = await open('#/beans', { signedIn: false });
check('the sign-in gate is shown', !!(await page.$('[data-send]')), 'no gate');
// `hidden` alone was not enough: #tabbar's id selector outranks [hidden]
check('no empty tab bar floats over the sign-in screen', !(await barVisible(page)), 'bar painted');

const blurb = await page.textContent('.glass .hint:last-of-type').catch(() => '');
const allText = await page.textContent('body');
check('the Safari note explains the Home Screen case',
  /Home Screen/.test(allText) && !/from the installed app the code is the way in/.test(allText),
  blurb);
await ctx.close();

/* ---- 2. and none on the pending screen ------------------------------ */
server.profiles = [{ user_id: ME, display_name: 'Norm', share_log: false, approved: false,
                     is_admin: false, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }];
({ ctx, page } = await open('#/beans'));
check('waiting-for-approval screen is shown', !!(await page.$('[data-recheck]')), 'not shown');
check('no tab bar there either', !(await barVisible(page)), 'bar painted');
await ctx.close();
server.profiles = [{ user_id: ME, display_name: 'Norm', share_log: false, approved: true, is_admin: false,
                     created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }];

/* ---- 3. settings sections fold --------------------------------------- */
({ ctx, page } = await open('#/settings'));
check('the tab bar IS shown in the app', await barVisible(page), 'missing');

const folds = await page.$$eval('.fold', els => els.map(e => e.dataset.fold));
check('sync and rendering are collapsible', folds.includes('sync') && folds.includes('render'), folds);
check('they start collapsed',
  await page.$$eval('.fold', els => els.every(e => !e.open)), 'open');
check('a collapsed section hides its fields',
  !(await page.$('[data-url]').then(el => el && el.isVisible())), 'url field visible');

await page.click('.fold[data-fold="sync"] > summary');
await page.waitForTimeout(500);
check('opening one reveals its fields', await page.isVisible('[data-url]'), 'still hidden');
check('the other stays closed',
  await page.$eval('.fold[data-fold="render"]', e => !e.open), 'both opened');

// account and data are not folded — they are the ones you actually come for
check('the account section is not folded', !!(await page.$('[data-saveprof]')), 'hidden');
await ctx.close();

/* ---- 4. double tap zooms rather than dropping a pin ------------------ */
({ ctx, page } = await open('#/cafes'));
const zoomOf = () => page.evaluate(() => window.__brewlogMap.getZoom());
const z0 = await zoomOf();

/* Well away from the centre: the map fits itself to the one café, so its
   marker sits dead centre, and a tap there hits the pin rather than the
   map — which would make this test pass without proving anything. */
const box = await page.$eval('#map', e => {
  const r = e.getBoundingClientRect();
  return { x: r.x + r.width * 0.28, y: r.y + r.height * 0.72 };
});
check('the chosen spot is empty map, not a pin', await page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  return !el?.closest('.leaflet-marker-icon, .leaflet-control');
}, box), 'landed on a marker');

await page.mouse.dblclick(box.x, box.y);
await page.waitForTimeout(1600);

check('double tap zooms in', (await zoomOf()) > z0, { before: z0, after: await zoomOf() });
check('and does not open the add-a-café sheet', !(await page.$('.sheet-backdrop')), 'sheet opened');
check('and drops no stray pin', !(await page.$('.leaflet-tooltip')), 'pin dropped');

// a single tap must still drop a pin
await page.mouse.click(box.x + 40, box.y - 90);
await page.waitForTimeout(1400);
check('a single tap still drops a pin', !!(await page.$('.sheet-backdrop')), 'no sheet');
await ctx.close();

/* ---- 5. the style reference reaches Gemini -------------------------- */
geminiBodies = [];
({ ctx, page } = await open('#/new'));
await page.setInputFiles('input[type="file"]', {
  name: 'bag.jpg', mimeType: 'image/png', buffer: PNG,
});
await page.waitForTimeout(4000);
// the studio render is on demand, not automatic
await page.click('[data-v="ai"]');
await page.waitForTimeout(6000);

const render = geminiBodies.find(b => /interactions|generateContent/.test(b.path));
check('a render request was made', !!render, geminiBodies.map(b => b.path));

const images = render ? JSON.stringify(render.body).match(/"(?:data|inline_data)"/g) || [] : [];
const parts = render?.body?.input || render?.body?.contents?.[0]?.parts || [];
const imageParts = parts.filter(p => p.type === 'image' || p.inline_data);
check('two images are sent — the reference and the bag', imageParts.length === 2,
  { imageParts: imageParts.length, images: images.length });

const text = JSON.stringify(parts.filter(p => p.text || p.type === 'text'));
check('the prompt says image 1 is reference only', /STYLE REFERENCE ONLY/.test(text), text.slice(0, 200));
check('and warns against copying its label',
  /must not appear in your output/i.test(text), text.slice(0, 200));
check('and names image 2 as the subject', /IMAGE 2 IS THE SUBJECT/.test(text), text.slice(0, 200));

// the reference must come first, or the labels point at the wrong picture
const order = parts.map(p => (p.type === 'image' || p.inline_data) ? 'img' : 'txt').join(',');
check('reference is labelled before the subject',
  /txt.*img.*txt.*img/.test(order), order);
await ctx.close();

console.log(fails.length ? `\n${fails.length} FAILING` : '\nall good');
await browser.close();
process.exit(fails.length ? 1 : 0);
