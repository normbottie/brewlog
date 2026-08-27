/* Export / import, photos included.

   The point of this file is the thing a backup is for: wipe the device,
   restore, and still have the picture of the bag. It also pins the merge
   rule, because the failure mode nobody notices until later is an old
   backup quietly overwriting entries that had moved on. */
import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const ME = '00000000-0000-4000-8000-000000000000';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, acceptDownloads: true });
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
  id: 'cafe-sey', user_id: ME, name: 'Sey Coffee', address: '18 Grattan St',
  lat: 40.7069, lng: -73.9339, rating: 5, notes: '', visited_on: '2026-06-01',
  deleted: false, created_at: iso('2026-01-01'), updated_at: iso('2026-01-01'),
};
const BEAN = {
  id: 'bean-a', user_id: ME, name: 'Kirinyaga AB', roaster: 'Onyx Coffee Lab',
  origin: 'Kenya', region: 'Kirinyaga', process: 'Washed', varietal: 'SL28',
  roast_level: 'Light', roast_date: '2026-05-01', price: '24.00', weight_g: '250',
  brew_method: 'V60', grind: '22g in', flavor_notes: ['blackcurrant'],
  ratings: { aromatics: 4, acidity: 5, sweetness: 4, aftertaste: 5, body: 3 },
  overall: 5, notes: 'Bright.', image_url: '', deleted: false,
  created_at: iso('2026-02-01'), updated_at: iso('2026-02-01'),
};
const BREW = {
  id: 'brew-1', user_id: ME, bean_id: 'bean-a', brewed_on: '2026-06-02', method: 'V60',
  recipe: '15g / 250g', verdict: 'up', notes: 'Nailed it.', image_url: '', thumb_url: '',
  deleted: false, created_at: iso('2026-06-02'), updated_at: iso('2026-06-02'),
};

const server = {
  beans: [BEAN], cafes: [CAFE], brews: [BREW],
  profiles: [{ user_id: ME, display_name: 'Norm', share_log: false, approved: true, is_admin: true, created_at: iso('2026-01-01'), updated_at: iso('2026-01-01') }],
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
  if (url.pathname.startsWith('/storage/v1/')) return json({ Key: 'ok' });
  const table = url.pathname.replace('/rest/v1/', '');
  if (req.method() === 'GET') return json(server[table] || []);
  server.upserts.push({ table, rows: JSON.parse(req.postData() || '[]') });
  return json([], 201);
});

await page.goto(base + '#/beans', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

/* A photo on the bag and one on the brew, so the export has both shapes. */
await page.evaluate(async () => {
  const { putBlob } = await import('./js/idb.js');
  const bytes = (n, fill) => new Blob([new Uint8Array(n).fill(fill)], { type: 'image/jpeg' });
  await putBlob('bean:bean-a:studio', bytes(2048, 7));
  await putBlob('bean:bean-a:raw', bytes(4096, 9));
  await putBlob('brew:brew-1:thumb', bytes(512, 3));
});

/* ---- 1. what an export contains ------------------------------------ */

const dump = await page.evaluate(async () => {
  const store = await import('./js/store.js');
  const seen = [];
  const { blob, counts } = await store.exportBackup((d, t) => seen.push(`${d}/${t}`));
  const text = await blob.text();
  return { text, counts, size: blob.size, progress: seen };
});
const parsed = JSON.parse(dump.text);

check('the file names itself', parsed.app === 'brewlog' && parsed.version === 2,
  { app: parsed.app, version: parsed.version });
check('rows are all there',
  parsed.beans.length === 1 && parsed.cafes.length === 1 && parsed.brews.length === 1,
  [parsed.beans.length, parsed.cafes.length, parsed.brews.length]);
check('photos ride along', parsed.blobs.length === 3, parsed.blobs.map(b => b.key));
check('including the raw original',
  parsed.blobs.some(b => b.key === 'bean:bean-a:raw'), parsed.blobs.map(b => b.key));
check('each photo carries real bytes',
  parsed.blobs.every(b => typeof b.data === 'string' && b.data.length > 100),
  parsed.blobs.map(b => b.data?.length));
check('sync bookkeeping stays out of the file',
  !/"_dirty"|"_imgDirty"/.test(dump.text), dump.text.slice(0, 200));
check('progress is reported per photo', dump.progress.length === 3, dump.progress);
check('the counts match the contents',
  dump.counts.photos === 3 && dump.counts.beans === 1 && dump.counts.brews === 1, dump.counts);

/* ---- 2. wipe the device, then restore ------------------------------ */

const restored = await page.evaluate(async (text) => {
  const { idb, getBlob } = await import('./js/idb.js');
  const store = await import('./js/store.js');
  for (const s of ['beans', 'cafes', 'brews', 'blobs']) await idb.clear(s);
  const before = (await idb.all('beans')).length;
  const counts = await store.importBackup(text);
  const bean = await idb.get('beans', 'bean-a');
  const studio = await getBlob('bean:bean-a:studio');
  const raw = await getBlob('bean:bean-a:raw');
  const thumb = await getBlob('brew:brew-1:thumb');
  return {
    before, counts,
    name: bean?.name,
    dirty: !!bean?._dirty,
    imgDirty: !!bean?._imgDirty,
    sizes: [studio?.size, raw?.size, thumb?.size],
    types: [studio?.type, thumb?.type],
    brews: (await idb.all('brews')).length,
    cafes: (await idb.all('cafes')).length,
  };
}, dump.text);

check('the wipe really emptied it', restored.before === 0, restored.before);
check('every row comes back', restored.counts.rows === 3, restored.counts);
check('the bag is itself again', restored.name === 'Kirinyaga AB', restored.name);
check('all three photos come back', restored.counts.photos === 3, restored.counts);
check('byte for byte',
  restored.sizes[0] === 2048 && restored.sizes[1] === 4096 && restored.sizes[2] === 512,
  restored.sizes);
check('with their content type', restored.types.every(t => t === 'image/jpeg'), restored.types);
check('restored rows are queued to push back up', restored.dirty && restored.imgDirty,
  { dirty: restored.dirty, imgDirty: restored.imgDirty });

/* ---- 3. an old backup must not undo newer work --------------------- */

const merge = await page.evaluate(async (text) => {
  const { idb } = await import('./js/idb.js');
  const store = await import('./js/store.js');
  const bean = await idb.get('beans', 'bean-a');
  bean.name = 'Renamed today';
  bean.updated_at = new Date(Date.now() + 60000).toISOString();
  await idb.put('beans', bean);
  const counts = await store.importBackup(text);
  return { counts, name: (await idb.get('beans', 'bean-a'))?.name };
}, dump.text);

check('a newer local entry is left alone', merge.name === 'Renamed today', merge.name);
check('and is counted as skipped', merge.counts.skipped >= 1, merge.counts);

/* ---- 4. rubbish in, a sentence out --------------------------------- */

const bad = await page.evaluate(async () => {
  const store = await import('./js/store.js');
  const out = {};
  try { await store.importBackup('{"app":"something-else"}'); } catch (e) { out.wrong = e.message; }
  try { await store.importBackup('not json at all'); } catch (e) { out.broken = e.message; }
  return out;
});
check('the wrong file is named as such', /Brewlog export/i.test(bad.wrong || ''), bad.wrong);
check('a corrupt file says so', /JSON/i.test(bad.broken || ''), bad.broken);

/* ---- 5. the button actually downloads ------------------------------ */

await page.goto(base + '#/settings', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
  page.click('[data-export]'),
]);
check('Export backup downloads a file', !!download, download?.suggestedFilename());
check('named for today',
  /^brewlog-\d{4}-\d{2}-\d{2}\.json$/.test(download?.suggestedFilename() || ''),
  download?.suggestedFilename());

console.log('\nerrors:', errs.length ? errs.join('\n') : 'none');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall good');
await browser.close();
process.exit(fails.length || errs.length ? 1 : 0);
