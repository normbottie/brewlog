/* Bag photos come down through short-lived signed URLs.

   The bucket is private now, so the only thing that may reach the network is
   a POST to /object/sign followed by a GET carrying that token. Anything
   hitting /object/public/ is the old, permanently-readable path and is a
   failure here — including for rows written before the change, which still
   hold a full public URL and must be folded back to a path by the client. */
import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const ME = '00000000-0000-4000-8000-000000000000';
const PROJECT = 'https://uszcbsovcdzzfxqtzazb.supabase.co';

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
const bean = (id, over) => ({
  id, user_id: ME, name: 'Bean ' + id, roaster: 'Onyx Coffee Lab', origin: 'Kenya',
  region: '', process: 'Washed', varietal: '', roast_level: 'Light', roast_date: '',
  price: '', weight_g: '', brew_method: 'V60', grind: '', flavor_notes: [],
  ratings: { aromatics: 4, acidity: 4, sweetness: 4, aftertaste: 4, body: 4 },
  overall: 4, notes: '', image_url: '', deleted: false,
  created_at: iso('2026-02-01'), updated_at: iso('2026-02-01'), ...over,
});

const server = {
  beans: [
    // written by this build: a bucket-relative path with our cache-buster
    bean('bean-new', { name: 'Path Row', image_url: `${ME}/bean-new.jpg?v=abc` }),
    // written before the bucket went private: a full public URL
    bean('bean-old', {
      name: 'Legacy Row',
      image_url: `${PROJECT}/storage/v1/object/public/bag-images/${ME}/bean-old.jpg?v=xyz`,
    }),
  ],
  cafes: [],
  brews: [],
  profiles: [{ user_id: ME, display_name: 'Norm', share_log: false, approved: true, is_admin: true, created_at: iso('2026-01-01'), updated_at: iso('2026-01-01') }],
  settings: [],
};

const hits = { sign: [], token: 0, public: 0 };

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
  const p = url.pathname;

  if (p.startsWith('/auth/v1/')) return json({ id: ME, email: 'norm@example.com' });

  // a private bucket answers a plain public read with 400, never bytes
  if (p.startsWith('/storage/v1/object/public/')) {
    hits.public++;
    return json({ statusCode: '400', message: 'Object not public' }, 400);
  }
  // POST asks for a signature; a GET on the same path is the download itself
  if (p.startsWith('/storage/v1/object/sign/') && req.method() === 'POST') {
    const path = p.replace('/storage/v1/object/sign/bag-images/', '');
    hits.sign.push(path);
    return json({ signedURL: `/object/sign/bag-images/${path}?token=stub-token` });
  }
  if (p.startsWith('/storage/v1/object/') && url.searchParams.get('token')) {
    hits.token++;
    return route.fulfill({ contentType: 'image/png', body: PNG });
  }
  if (p.startsWith('/storage/v1/')) return json({ Key: 'ok' });

  const table = p.replace('/rest/v1/', '');
  if (req.method() === 'GET') return json(server[table] || []);
  return json([], 201);
});

const go = async (hash) => {
  await page.goto(base + hash, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
};

/* ---- 1. path extraction, both row shapes --------------------------- */

await go('#/beans');
const paths = await page.evaluate(async (project) => {
  const sb = await import('./js/supabase.js');
  return {
    fromPath: sb.storagePath('11111111/bean.jpg?v=abc'),
    fromPublic: sb.storagePath(`${project}/storage/v1/object/public/bag-images/11111111/bean.jpg?v=abc`),
    fromSigned: sb.storagePath(`${project}/storage/v1/object/sign/bag-images/11111111/bean.jpg?token=t`),
    fromBucketPrefixed: sb.storagePath('bag-images/11111111/bean.jpg'),
    fromForeign: sb.storagePath('https://example.com/somebodys.jpg'),
  };
}, PROJECT);
check('a stored path stays a path', paths.fromPath === '11111111/bean.jpg', paths.fromPath);
check('a legacy public URL folds back to its path', paths.fromPublic === '11111111/bean.jpg', paths.fromPublic);
check('so does an already-signed URL', paths.fromSigned === '11111111/bean.jpg', paths.fromSigned);
check('and a bucket-prefixed path', paths.fromBucketPrefixed === '11111111/bean.jpg', paths.fromBucketPrefixed);
check('another host is not treated as ours', paths.fromForeign === '', paths.fromForeign);

const signed = await page.evaluate(async () => {
  const sb = await import('./js/supabase.js');
  return sb.signedImageURL('abc/def.jpg');
});
check('signing returns an absolute URL with a token',
  /\/storage\/v1\/object\/sign\/bag-images\/abc\/def\.jpg\?token=/.test(signed || ''), signed);

/* ---- 2. the bag screens fetch through a signature ------------------ */

/* Forget the copies the list screen already cached, or the screens below
   would pass without going near the network at all. The reload matters as
   much as the clear: a hash-only navigation keeps the module's object-URL
   cache alive, and the photo would come back from memory. */
await page.evaluate(async () => {
  const { idb } = await import('./js/idb.js');
  await idb.clear('blobs');
  await idb.clear('meta');
});
hits.sign = []; hits.token = 0; hits.public = 0;

await page.goto(base + '#/bean/bean-new', { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const heroNew = await page.$eval('[data-hero]',
  el => ({ src: el.getAttribute('src') || '', w: el.naturalWidth }));
check('a path row renders its photo', heroNew.src.startsWith('blob:') && heroNew.w > 0, heroNew);
check('by signing that exact path', hits.sign.includes(`${ME}/bean-new.jpg`), hits.sign);
check('and fetching it with the token', hits.token > 0, hits.token);

await go('#/bean/bean-old');
await page.waitForTimeout(1500);
const heroOld = await page.$eval('[data-hero]',
  el => ({ src: el.getAttribute('src') || '', w: el.naturalWidth }));
check('a legacy row renders too', heroOld.src.startsWith('blob:') && heroOld.w > 0, heroOld);
check('by signing the path inside its old URL', hits.sign.includes(`${ME}/bean-old.jpg`), hits.sign);
check('nothing reaches the public endpoint', hits.public === 0, hits.public);

/* ---- 3. nothing durable is a working link -------------------------- */

const stored = await page.evaluate(async () => {
  const { idb } = await import('./js/idb.js');
  return (await idb.all('beans')).map(b => b.image_url);
});
check('no row holds a token', !stored.some(u => /token=/.test(String(u))), stored);

const upload = await page.evaluate(async () => {
  const sb = await import('./js/supabase.js');
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
  return sb.uploadImage('someone/bean-x.jpg', blob);
});
check('uploading hands back a path, not a URL', upload === 'someone/bean-x.jpg', upload);

console.log('\nerrors:', errs.length ? errs.join('\n') : 'none');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall good');
await browser.close();
process.exit(fails.length || errs.length ? 1 : 0);
