/* Reading the bag label must work for a user who has no personal API key —
   the shared proxy supplies it. Regression for "null is not an object
   (evaluating 'cfg.provider')", which threw before any request went out. */
import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const ME = '00000000-0000-4000-8000-000000000000';

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

await page.addInitScript((me) => {
  try {
    // signed in, but deliberately NO brewlog.img.* key: the proxy's job
    localStorage.setItem('brewlog.auth.session', JSON.stringify({
      access_token: 'test-token', refresh_token: 'r',
      expires_at: Date.now() + 86400000,
      user: { id: me, email: 'test@example.com' },
    }));
  } catch {}
}, ME);

let proxyCalls = [];
await page.route('**/basemaps.cartocdn.com/**', r => r.abort());
await page.route('**/generativelanguage.googleapis.com/**', r =>
  r.fulfill({ status: 500, body: 'the browser must never call Google directly' }));

await page.route('**/*.supabase.co/**', async (route) => {
  const url = new URL(route.request().url());
  const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

  if (url.pathname.startsWith('/auth/v1/')) return json({ id: ME, email: 'test@example.com' });

  if (url.pathname === '/functions/v1/gemini-proxy') {
    const path = url.searchParams.get('path') || '';
    proxyCalls.push(path);
    if (path.startsWith('/v1beta/models?')) {
      return json({ models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] });
    }
    // whichever endpoint it reaches for, answer with the label JSON
    const label = JSON.stringify({
      name: 'Slow Motion', roaster: 'Counter Culture Coffee', origin: 'Colombia',
      region: 'Huila', process: 'Washed', varietal: 'Caturra', roast_level: 'Medium',
      roast_date: '', weight_g: '340', brew_method: 'Espresso',
      flavor_notes: ['cocoa', 'orange'],
    });
    if (path === '/v1beta/interactions') {
      return json({ output: [{ type: 'text', text: label }] });
    }
    return json({ candidates: [{ content: { parts: [{ text: label }] } }] });
  }

  if (url.pathname.startsWith('/rest/v1/')) {
    if (route.request().method() !== 'GET') return json([], 201);
    // an established account, so first-run setup doesn't take the screen
    return json(url.pathname.endsWith('/profiles')
      ? [{ user_id: ME, display_name: 'Norm', share_log: false,
           created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }]
      : []);
  }
  if (url.pathname.startsWith('/storage/v1/')) return json({ Key: 'ok' });
  return json({});
});

await page.goto(base + '#/new', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// hand the editor a photo, the way the file picker would
await page.setInputFiles('input[type="file"]', {
  name: 'bag.jpg', mimeType: 'image/jpeg',
  buffer: Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAgACABAREA/8QAHwAAAQUBAQEB' +
    'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh' +
    'ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
    'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
    'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiiigAooooAKKKKA' +
    'CiiigAooooAKKKKACiiigAooooAKKKKAP//Z', 'base64'),
});
await page.waitForTimeout(3500);

const readBtn = await page.$('[data-read]');
check('the label button is offered without a personal key', !!readBtn, 'missing');

await readBtn.click();
await page.waitForTimeout(4000);

const status = await page.$eval('[data-readstatus]', e => e.textContent.trim()).catch(() => '');
// Safari says "null is not an object (evaluating 'cfg.provider')";
// Chromium says "Cannot read properties of null (reading 'provider')"
check('no null dereference',
  !/null is not an object|reading '(provider|key|model)'|cfg\.provider/.test(status), status);
check('the request went through the proxy', proxyCalls.length > 0, proxyCalls);

const name = await page.$eval('[data-f="name"]', e => e.value).catch(() => '');
const roaster = await page.$eval('[data-f="roaster"]', e => e.value).catch(() => '');
check('fields filled in from the label', name === 'Slow Motion', { name, roaster, status });
check('roaster filled in', roaster === 'Counter Culture Coffee', roaster);

console.log('\nerrors:', errs.length ? errs.join('\n') : 'none');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall good');
await browser.close();
process.exit(fails.length || errs.length ? 1 : 0);
