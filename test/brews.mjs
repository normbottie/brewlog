/* Brews: logging a cup against a bag, the strip, the verdict, the count
   badge, and — the reason the feature is affordable at all — that the full
   photo is only fetched when a brew is actually opened. */
import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const ME = '00000000-0000-4000-8000-000000000000';
const THEM = '11111111-1111-4111-8111-111111111111';

// distinguishable by a single pixel: thumb is red, full is blue
const RED = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFUlEQVR4nGP8z4AKmBhIFRhVMKoAAI5QAR9Qm0MgAAAAAElFTkSuQmCC', 'base64');
const BLUE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFUlEQVR4nGNkYPjPgAqYGEgVGFUwqgAAjbABI+8YlwUAAAAASUVORK5CYII=', 'base64');
// a real JPEG for the file picker, so brewVariants has something to decode
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAgACABAREA/8QAHwAAAQUBAQEB' +
  'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh' +
  'ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
  'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
  'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiiigAooooAKKKKA' +
  'CiiigAooooAKKKKACiiigAooooAKKKKAP//Z', 'base64');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const fails = [];
const check = (name, ok, got) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) fails.push(name);
};

const HOST = 'https://uszcbsovcdzzfxqtzazb.supabase.co/storage/v1/object/public/bag-images';

const bean = (id, user_id, name) => ({
  id, user_id, name, roaster: 'Buddy Brew', origin: 'Sumatra',
  brew_method: 'Espresso', flavor_notes: [],
  ratings: { aromatics: 3, acidity: 3, sweetness: 3, aftertaste: 3, body: 3 },
  overall: 4, notes: '', image_url: '', deleted: false,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
});

const brew = (id, bean_id, user_id, over = {}) => ({
  id, bean_id, user_id, brewed_on: '2026-08-20', method: 'Espresso',
  recipe: '18 g → 38 g, 27 s', verdict: 'up', notes: 'Syrupy.',
  thumb_url: `${HOST}/brew-${id}-t.jpg?v=1`,
  image_url: `${HOST}/brew-${id}.jpg?v=1`,
  deleted: false,
  created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z',
  ...over,
});

let server, hits;
const reset = () => {
  server = {
    beans: [bean('bean-1', ME, 'Sumatra'), bean('bean-2', ME, 'Kenya')],
    brews: [], cafes: [],
    profiles: [{ user_id: ME, display_name: 'Norm', share_log: true, approved: true, is_admin: false,
                 created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }],
    writes: [], uploads: [],
  };
  hits = { thumb: 0, full: 0 };
};
reset();

async function open(hash, as = ME) {
  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('pageerror:', e.message); fails.push('pageerror'); });
  await page.addInitScript((me) => {
    try {
      localStorage.setItem('brewlog.auth.session', JSON.stringify({
        access_token: 't', refresh_token: 'r', expires_at: Date.now() + 86400000,
        user: { id: me, email: 'norm@example.com' },
      }));
      localStorage.setItem('brewlog.scope.beans', '1');
    } catch {}
  }, as);
  await page.route('**/basemaps.cartocdn.com/**', r => r.abort());
  await page.route('**/*.supabase.co/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (url.pathname.startsWith('/auth/v1/')) return json({ id: as, email: 'norm@example.com' });

    if (url.pathname.startsWith('/storage/v1/object/public/')) {
      const isThumb = /-t\.jpg$/.test(url.pathname);
      if (isThumb) hits.thumb++; else hits.full++;
      return route.fulfill({ contentType: 'image/png', body: isThumb ? RED : BLUE });
    }
    if (url.pathname.startsWith('/storage/v1/')) {
      if (req.method() !== 'GET') server.uploads.push(url.pathname);
      return json({ Key: 'ok' });
    }
    const table = url.pathname.replace('/rest/v1/', '');
    if (req.method() === 'GET') return json(server[table] || []);
    server.writes.push({ table, rows: JSON.parse(req.postData() || '[]') });
    return json([], 201);
  });
  await page.goto(base + hash, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3200);
  return { ctx, page };
}

/** The colour of a rendered image, to tell thumb from full. */
const pixelOf = (page, sel) => page.evaluate((s) => new Promise((resolve) => {
  const img = document.querySelector(s);
  if (!img || !img.src || img.src.startsWith('data:')) return resolve(null);
  const read = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    resolve([d[0], d[1], d[2]]);
  };
  if (img.complete && img.naturalWidth) read();
  else img.onload = read;
}), sel);
const isRed = (c) => c && c[0] > c[2] + 40;
const isBlue = (c) => c && c[2] > c[0] + 40;

/* ---- 1. a bag with no brews invites one -------------------------- */
let { ctx, page } = await open('#/bean/bean-1');
check('the bean screen has a brews section',
  !!(await page.$('[data-brews]')), 'missing');
check('an empty bag offers to log the first cup',
  !!(await page.$('[data-newbrew]')), 'no add tile');
check('and says what the section is for',
  /lands here, next to the bag/.test(await page.textContent('[data-brews]')),
  await page.textContent('[data-brews]'));

/* ---- 2. logging one ------------------------------------------------ */
await page.click('[data-newbrew]');
await page.waitForTimeout(700);
check('the sheet opens', !!(await page.$('.sheet [data-save]')), 'no sheet');
/* An img styled `display: block` outranks the browser's [hidden] rule, so
   the empty preview can silently reserve a full square of nothing. */
check('the empty photo well is not holding a blank square open',
  await page.$eval('.brew-drop', e => e.getBoundingClientRect().height) < 220,
  await page.$eval('.brew-drop', e => Math.round(e.getBoundingClientRect().height)));
check('the method starts on the bag\'s own',
  await page.$eval('[data-m="Espresso"]', e => e.getAttribute('aria-pressed')) === 'true',
  'not preselected');

// a brew without a photo is not a brew
await page.click('[data-save]');
await page.waitForTimeout(600);
check('it refuses to save without a photo',
  /Add a photo/.test(await page.textContent('[data-status]')),
  await page.textContent('[data-status]'));

await page.setInputFiles('.sheet input[type="file"]', {
  name: 'cup.jpg', mimeType: 'image/jpeg', buffer: JPEG,
});
await page.waitForTimeout(1800);
check('the photo previews once chosen',
  await page.$eval('[data-preview]', e => !e.hidden), 'still hidden');

await page.click('[data-v="up"]');
await page.waitForTimeout(200);
check('a verdict can be set',
  await page.$eval('[data-v="up"]', e => e.getAttribute('aria-pressed')) === 'true', 'not set');
// tapping it again clears it — no verdict is a legitimate answer
await page.click('[data-v="up"]');
await page.waitForTimeout(200);
check('and cleared again',
  await page.$eval('[data-v="up"]', e => e.getAttribute('aria-pressed')) === 'false', 'still set');
await page.click('[data-v="up"]');

await page.fill('[data-recipe]', '18 g → 38 g, 27 s');
await page.fill('[data-notes]', 'Ground finer, stopped gushing.');
await page.click('[data-save]');
await page.waitForTimeout(3500);

const saved = server.writes.flatMap(w => w.table === 'brews' ? w.rows : []);
check('the brew is pushed', saved.length > 0, server.writes.map(w => w.table));
check('it belongs to the bag',
  saved.every(r => r.bean_id === 'bean-1'), saved.map(r => r.bean_id));
check('the verdict is recorded', saved.at(-1)?.verdict === 'up', saved.at(-1)?.verdict);
check('the recipe and note are recorded',
  /27 s/.test(saved.at(-1)?.recipe || '') && /gushing/.test(saved.at(-1)?.notes || ''),
  { recipe: saved.at(-1)?.recipe, notes: saved.at(-1)?.notes });

/* Two files, not one: the thumbnail everything pulls and the full photo
   only an opened brew fetches. */
check('both sizes are uploaded',
  server.uploads.some(p => /-t\.jpg$/.test(p)) &&
  server.uploads.some(p => /brew-[^/]+\.jpg$/.test(p) && !/-t\.jpg$/.test(p)),
  server.uploads);
check('the bag itself is untouched',
  !server.writes.some(w => w.table === 'beans'), 'bean rewritten');
await ctx.close();

/* ---- 3. the strip, and fetch-on-open ------------------------------- */
reset();
server.brews = [
  brew('brew-1', 'bean-1', ME, { brewed_on: '2026-08-24' }),
  brew('brew-2', 'bean-1', ME, { brewed_on: '2026-08-22', verdict: 'down' }),
  brew('brew-3', 'bean-1', ME, { brewed_on: '2026-08-20', verdict: null }),
];
({ ctx, page } = await open('#/bean/bean-1'));

const tiles = await page.$$eval('.brew-tile', els => els.map(e => e.dataset.brew));
check('every brew has a tile', tiles.length === 3, tiles);
check('newest first', tiles[0] === 'brew-1' && tiles.at(-1) === 'brew-3', tiles);
check('verdicts show on the tiles',
  (await page.$$('.brew-verdict')).length === 2, await page.$$eval('.brew-verdict', e => e.length));
check('an unrated brew gets no verdict mark',
  !(await page.$('[data-brew="brew-3"] .brew-verdict')), 'marked');

/* A thumbs-down must actually be drawn. Rotating the <svg> root instead of
   an inner <g> carried it out of its own box: still in the DOM, still the
   right size, and completely invisible. */
const downGlyph = await page.evaluate(() => {
  const badge = document.querySelector('[data-brew="brew-2"] .brew-verdict');
  const g = badge?.querySelector('svg g');
  if (!g) return { ok: false, why: 'no inner group' };
  const box = g.getBoundingClientRect();
  // measured against the badge, which never moves — measuring against the
  // <svg> would follow the very transform this is meant to catch
  const host = badge.getBoundingClientRect();
  return {
    ok: box.width > 2 && box.height > 2 &&
        box.left >= host.left - 1 && box.right <= host.right + 1 &&
        box.top >= host.top - 1 && box.bottom <= host.bottom + 1,
    glyph: [Math.round(box.width), Math.round(box.height)],
    slack: [Math.round(box.left - host.left), Math.round(box.top - host.top)],
  };
});
check('the thumbs-down is actually visible', downGlyph.ok, downGlyph);
check('the strip summarises the verdicts',
  /1 up, 1 down/.test(await page.textContent('.brew-foot')),
  await page.textContent('.brew-foot'));
check('thumbnails render', isRed(await pixelOf(page, '[data-bimg="brew-1"]')),
  await pixelOf(page, '[data-bimg="brew-1"]'));

/* THE POINT: three brews on screen must not have pulled three full photos. */
check('the strip fetches only thumbnails',
  hits.thumb >= 3 && hits.full === 0, hits);
await ctx.close();

/* ---- 4. opening one pulls the full photo --------------------------- */
reset();
server.brews = [brew('brew-1', 'bean-1', ME)];
({ ctx, page } = await open('#/brew/brew-1'));
await page.waitForTimeout(2200);

check('the full photo is fetched on open', hits.full === 1, hits);
check('and it is what gets shown', isBlue(await pixelOf(page, '[data-photo]')),
  await pixelOf(page, '[data-photo]'));
check('the details are shown',
  /27 s/.test(await page.textContent('.kv')), await page.textContent('.kv').catch(() => ''));
check('the verdict is shown', !!(await page.$('.verdict-chip')), 'missing');
check('it links back to the bag', !!(await page.$('[data-bean]')), 'no link');
await ctx.close();

/* ---- 5. the count badge on the grid -------------------------------- */
reset();
server.brews = [
  brew('brew-1', 'bean-1', ME), brew('brew-2', 'bean-1', ME),
  brew('brew-3', 'bean-2', ME, { deleted: true }),
];
({ ctx, page } = await open('#/beans'));
const badges = await page.$$eval('.bean-card', cards => cards.map(c => ({
  name: c.querySelector('.name')?.textContent.trim(),
  count: c.querySelector('.brew-count')?.textContent.trim(),
})));
check('a bag with brews shows the count',
  badges.find(b => b.name === 'Sumatra')?.count === '2', badges);
check('a deleted brew is not counted',
  !badges.find(b => b.name === 'Kenya')?.count, badges);
await ctx.close();

/* ---- 6. someone else's brew is read-only --------------------------- */
reset();
server.profiles.push({ user_id: THEM, display_name: 'Micah', share_log: true, approved: true,
                       is_admin: false, created_at: '2026-01-02T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' });
server.beans.push(bean('bean-theirs', THEM, 'Their Bag'));
server.brews = [brew('brew-theirs', 'bean-theirs', THEM)];
({ ctx, page } = await open('#/brew/brew-theirs'));
check('a shared brew is marked read-only',
  /read only/i.test(await page.textContent('.read-only-note').catch(() => '')),
  await page.textContent('.read-only-note').catch(() => 'no note'));
check('with no edit button', !(await page.$('[data-edit]')), 'edit shown');

await page.goto(base + '#/bean/bean-theirs', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
check('and their bag offers no add tile', !(await page.$('[data-newbrew]')), 'add shown');
await ctx.close();

console.log(fails.length ? `\n${fails.length} FAILING` : '\nall good');
await browser.close();
process.exit(fails.length ? 1 : 0);
