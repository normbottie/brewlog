/* Importing someone else's bag into your own log.
   The bag's facts should come across; their verdict on it should not. */
import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const ME = '00000000-0000-4000-8000-000000000000';
const THEM = '11111111-1111-4111-8111-111111111111';

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

const THEIRS = {
  id: 'bean-theirs', user_id: THEM, name: 'Slow Motion', roaster: 'Counter Culture',
  origin: 'Colombia', region: 'Huila', process: 'Washed', varietal: 'Caturra',
  roast_level: 'Medium', roast_date: '2026-05-01', price: '22.00', weight_g: '340',
  brew_method: 'Flat White', grind: '18g in, 38g out',
  flavor_notes: ['cocoa', 'orange'],
  ratings: { aromatics: 4.5, acidity: 2, sweetness: 5, aftertaste: 4, body: 3.5 },
  overall: 5, notes: 'Micah thought it was superb.', deleted: false,
  image_url: 'https://uszcbsovcdzzfxqtzazb.supabase.co/storage/v1/object/public/bag-images/t.jpg?v=1',
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
};

const server = {
  beans: [THEIRS],
  cafes: [],
  profiles: [
    { user_id: ME, display_name: 'Norm', share_log: true, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    { user_id: THEM, display_name: 'Micah', share_log: true, created_at: '2026-01-02T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' },
  ],
  upserts: [],
  uploads: [],
};

await page.addInitScript((me) => {
  try {
    localStorage.setItem('brewlog.auth.session', JSON.stringify({
      access_token: 't', refresh_token: 'r', expires_at: Date.now() + 86400000,
      user: { id: me, email: 'norm@example.com' },
    }));
    localStorage.setItem('brewlog.scope.beans', '1');   // Everyone
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
  if (url.pathname.startsWith('/storage/v1/')) {
    if (req.method() !== 'GET') server.uploads.push(url.pathname);
    return json({ Key: 'ok' });
  }
  const table = url.pathname.replace('/rest/v1/', '');
  if (req.method() === 'GET') return json(server[table] || []);
  server.upserts.push({ table, rows: JSON.parse(req.postData() || '[]') });
  return json([], 201);
});

await page.goto(base + `#/bean/${THEIRS.id}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

check('their entry is marked read-only', !!(await page.$('.read-only-note')), 'no note');
check('no edit button on their entry', !(await page.$('[data-edit]')), 'edit shown');
check('the import button is offered', !!(await page.$('[data-import]')), 'missing');

await page.click('[data-import]');
await page.waitForTimeout(3500);

check('lands in the editor for a new entry',
  /\/edit$/.test(page.url()) && !page.url().includes(THEIRS.id), page.url());

const f = async (k) => page.$eval(`[data-f="${k}"]`, e => e.value).catch(() => null);
check('bag facts came across',
  (await f('name')) === 'Slow Motion' && (await f('roaster')) === 'Counter Culture' &&
  (await f('origin')) === 'Colombia' && (await f('region')) === 'Huila',
  { name: await f('name'), roaster: await f('roaster'), origin: await f('origin') });
check('process and varietal came across',
  (await f('process')) === 'Washed' && (await f('varietal')) === 'Caturra',
  { process: await f('process'), varietal: await f('varietal') });
check('the roaster\'s printed notes came across',
  /cocoa/.test(await f('flavor_notes') || '') && /orange/.test(await f('flavor_notes') || ''),
  await f('flavor_notes'));

check('their tasting notes did NOT come across', (await f('notes')) === '', await f('notes'));
check('their grind did NOT come across', (await f('grind')) === '', await f('grind'));
check('their roast date did NOT come across', (await f('roast_date')) === '', await f('roast_date'));

const sliders = await page.$$eval('input[type="range"][data-axis]', els => els.map(e => Number(e.value)));
check('the tasting profile starts neutral, not theirs',
  sliders.length > 0 && sliders.every(v => v === 3), sliders);

// save it, then confirm ownership and that it's mine to edit
await page.click('[data-save]');
await page.waitForTimeout(3500);

const pushed = server.upserts.flatMap(u => u.table === 'beans' ? u.rows : [])
  .filter(r => r.id !== THEIRS.id);
check('the copy is pushed as mine', pushed.length > 0 && pushed.every(r => r.user_id === ME),
  pushed.map(r => ({ id: r.id, user_id: r.user_id, name: r.name })));
check('the copy carries no trace of their rating',
  pushed.every(r => !r.overall && !r.notes), pushed.map(r => ({ overall: r.overall, notes: r.notes })));

/* The photo has to be a copy under my own path — not a link to theirs,
   which would break the day they re-shoot the bag or stop sharing. */
const newId = pushed[0]?.id;
check('the photo was uploaded under my own id',
  server.uploads.some(p => p.includes(`${ME}/${newId}`)),
  { uploads: server.uploads, newId });
check('and does not point at their file',
  pushed.every(r => !String(r.image_url || '').includes('/t.jpg')),
  pushed.map(r => r.image_url));

/* ---- importing the same bag twice asks first ----------------------- */
await page.goto(base + `#/bean/${THEIRS.id}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.click('[data-import]');
await page.waitForTimeout(1500);

check('a duplicate import asks instead of silently copying',
  !!(await page.$('[data-open]')) && !!(await page.$('[data-again]')),
  await page.$eval('.sheet-head h3', e => e.textContent.trim()).catch(() => 'no sheet'));

await page.click('[data-open]');
await page.waitForTimeout(2000);
check('opening mine leaves their entry',
  !page.url().includes(THEIRS.id) && /#\/bean\//.test(page.url()), page.url());
check('the opened entry is editable — it is mine now',
  !!(await page.$('[data-edit]')), 'read-only');

console.log('\nerrors:', errs.length ? errs.join('\n') : 'none');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall good');
await browser.close();
process.exit(fails.length || errs.length ? 1 : 0);
