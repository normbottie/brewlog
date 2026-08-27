/* Searching for a café you have already logged.

   The bug this pins: iOS smart punctuation saves "Sweet Caroline’s" with a
   curly apostrophe, the keyboard types a straight one, and the list said
   nothing matched. Both sides are folded now — and the list has to react on
   every keystroke, not on Enter. */
import { chromium } from 'playwright';
import { fold, matches } from '../js/search.js';

const base = 'http://localhost:8899/index.html';
const ME = '00000000-0000-4000-8000-000000000000';

const fails = [];
const check = (name, ok, got) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) fails.push(name);
};

/* ---- 1. the fold itself -------------------------------------------- */

check('a straight apostrophe finds a curly one', matches('Sweet Caroline’s', "Sweet Caroline's"));
check('and a curly one finds a straight one', matches("Sweet Caroline's", 'Sweet Caroline’s'));
check('leaving it out still finds it', matches('Sweet Caroline’s', 'sweet carolines'));
check('accents fold too', matches('Abraço', 'abraco'));
check('and so do dashes', matches('Nine–Bar', 'nine-bar'));
check('case is ignored', matches('Sey Coffee', 'SEY'));
check('an empty query matches everything', matches('anything', '   '));
check('a query that is really absent still misses', !matches('Sey Coffee', 'onyx'));
check('the fold is stable', fold('  Sweet   Caroline’s — Café ') === 'sweet carolines - cafe',
  fold('  Sweet   Caroline’s — Café '));

/* ---- 2. the café list, keystroke by keystroke ---------------------- */

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));

const iso = (d) => new Date(d).toISOString();
const cafe = (id, name, over = {}) => ({
  id, user_id: ME, name, address: '1 Test St', lat: 40.7, lng: -74, rating: 4,
  notes: '', visited_on: '2026-06-01', deleted: false,
  created_at: iso('2026-01-01'), updated_at: iso('2026-01-01'), ...over,
});

const server = {
  beans: [],
  cafes: [
    cafe('cafe-caroline', 'Sweet Caroline’s'),   // curly, as iOS saved it
    cafe('cafe-abraco', 'Abraço'),
    cafe('cafe-sey', 'Sey Coffee'),
  ],
  brews: [],
  profiles: [{ user_id: ME, display_name: 'Norm', share_log: false, approved: true, is_admin: true, created_at: iso('2026-01-01'), updated_at: iso('2026-01-01') }],
  settings: [],
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
  return json([], 201);
});

await page.goto(base + '#/cafes', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const names = () => page.$$eval('.cafe-row .nm', els => els.map(e => e.textContent.trim()));
const all = await names();
check('all three are listed to begin with', all.length === 3, all);

/* type it the way the keyboard gives it: one character at a time */
const box = await page.$('[data-q]');
const seen = [];
for (const chunk of ['Sw', 'eet Car', "oline's"]) {
  await box.type(chunk, { delay: 20 });
  await page.waitForTimeout(120);
  seen.push(await names());
}

check('results narrow while typing, before any Enter',
  seen[0].length === 1 && seen[0][0].startsWith('Sweet'), seen[0]);
check('a straight apostrophe keeps the match',
  seen[2].length === 1 && seen[2][0].startsWith('Sweet'), seen[2]);

await box.fill('sweet carolines');
await page.waitForTimeout(150);
check('so does dropping the apostrophe', (await names()).length === 1, await names());

await box.fill('abraco');
await page.waitForTimeout(150);
const acc = await names();
check('an unaccented query finds the accented café',
  acc.length === 1 && acc[0] === 'Abraço', acc);

await box.fill('');
await page.waitForTimeout(150);
check('clearing the box brings everyone back', (await names()).length === 3, await names());

console.log('\nerrors:', errs.length ? errs.join('\n') : 'none');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall good');
await browser.close();
process.exit(fails.length || errs.length ? 1 : 0);
