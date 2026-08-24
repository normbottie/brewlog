/* First-run setup, and the bean-card top alignment.

   The card check belongs here because both symptoms had the same trigger:
   a shared entry makes its card taller, the grid stretches the rest of the
   row to match, and a <button> centres its content box — so every other
   card pushed its photo down and showed a band of card chrome above it. */
import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const ME = '00000000-0000-4000-8000-000000000000';
const THEM = '11111111-1111-4111-8111-111111111111';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const fails = [];
const check = (name, ok, got) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) fails.push(name);
};

const server = { profiles: [], beans: [], cafes: [], upserts: [] };

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('pageerror:', e.message); fails.push('pageerror'); });
  await page.addInitScript((me) => {
    try {
      localStorage.setItem('brewlog.auth.session', JSON.stringify({
        access_token: 't', refresh_token: 'r', expires_at: Date.now() + 86400000,
        user: { id: me, email: 'norm.bottie@gmail.com' },
      }));
    } catch {}
  }, ME);
  await page.route('**/basemaps.cartocdn.com/**', r => r.abort());
  await page.route('**/*.supabase.co/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.pathname.startsWith('/auth/v1/')) return json({ id: ME, email: 'norm.bottie@gmail.com' });
    if (url.pathname.startsWith('/storage/v1/')) return json({ Key: 'ok' });
    const table = url.pathname.replace('/rest/v1/', '');
    if (req.method() === 'GET') return json(server[table] || []);
    const rows = JSON.parse(req.postData() || '[]');
    server.upserts.push({ table, rows });
    if (table === 'profiles') {
      for (const r of rows) {
        const i = (server.profiles).findIndex(p => p.user_id === r.user_id);
        if (i >= 0) server.profiles[i] = { ...server.profiles[i], ...r };
        else server.profiles.push({ created_at: '2026-01-01T00:00:00.000Z', ...r });
      }
    }
    return json([], 201);
  });
  return { ctx, page };
}

/* ---- 1. a brand-new account is asked to set up ---------------------- */
let { ctx, page } = await newPage();
await page.goto(base + '#/beans', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

check('setup is shown before the app', !!(await page.$('[data-done]')), await page.title());
check('the tab bar is hidden during setup',
  await page.$eval('#tabbar', e => e.hidden) === true, 'visible');
check('name is pre-filled from the email',
  await page.$eval('[data-name]', e => e.value) === 'Norm Bottie',
  await page.$eval('[data-name]', e => e.value));
check('sharing starts off — opting in has to be deliberate',
  await page.$eval('[data-share]', e => e.checked) === false, 'checked');

// an empty name is refused rather than saved as blank
await page.fill('[data-name]', '   ');
await page.click('[data-done]');
await page.waitForTimeout(700);
check('an empty name is refused',
  /Pick a name/.test(await page.$eval('[data-status]', e => e.textContent)),
  await page.$eval('[data-status]', e => e.textContent));
check('still on setup after the refusal', !!(await page.$('[data-done]')), 'left setup');

await page.fill('[data-name]', 'Norm');
await page.click('[data-share]');
await page.click('[data-done]');
await page.waitForTimeout(3000);

check('setup hands off to the beans list',
  !(await page.$('[data-done]')) && /#\/beans/.test(page.url()), page.url());
const saved = server.upserts.find(u => u.table === 'profiles')?.rows?.[0];
check('the profile was saved', saved?.display_name === 'Norm' && saved?.share_log === true, saved);

// Back must not return to setup
await page.goBack();
await page.waitForTimeout(1200);
check('Back does not return to setup', !(await page.$('[data-done]')), page.url());

await ctx.close();

/* ---- 2. it does not appear again ------------------------------------ */
({ ctx, page } = await newPage());
await page.goto(base + '#/beans', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
check('a returning account skips setup', !(await page.$('[data-done]')), 'setup shown again');
check('the app is usable', await page.$eval('#tabbar', e => e.hidden) === false, 'tabbar hidden');
await ctx.close();

/* ---- 3. bean cards line up, shared or not -------------------------- */
const bean = (id, user_id, name, extra = {}) => ({
  id, user_id, name, roaster: 'R', origin: 'Kenya', brew_method: 'Espresso',
  flavor_notes: [], ratings: { aromatics: 3, acidity: 3, sweetness: 3, aftertaste: 3, body: 3 },
  overall: 4, notes: '', image_url: '', deleted: false,
  created_at: '2026-0' + id.slice(-1) + '-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z', ...extra,
});
server.profiles.push({ user_id: THEM, display_name: 'Micah', share_log: true, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' });
// the shared card is the tall one: it carries an owner badge the others lack
server.beans = [bean('bean-1', THEM, 'Shared one'), bean('bean-2', ME, 'Mine two'),
                bean('bean-3', ME, 'Mine three'), bean('bean-4', ME, 'Mine four')];

({ ctx, page } = await newPage());
await page.goto(base + '#/beans', { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
await page.click('[data-sc="all"]').catch(() => {});
await page.waitForTimeout(1500);

const geom = await page.$$eval('.bean-card', cards => cards.map(c => {
  const img = c.querySelector('img.shot');
  return {
    name: c.querySelector('.name')?.textContent.trim(),
    gap: Math.round(img.getBoundingClientRect().top - c.getBoundingClientRect().top),
  };
}));
check('cards were rendered', geom.length === 4, geom);
// 1px of border is expected; anything more is card chrome showing above the photo
check('no card shows a band above its photo', geom.every(g => g.gap <= 2), geom);
check('every photo starts at the same offset',
  new Set(geom.map(g => g.gap)).size === 1, geom);

await ctx.close();
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall good');
await browser.close();
process.exit(fails.length ? 1 : 0);
