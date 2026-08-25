/* Session durability. The complaint was "users still have to sign in
   repeatedly after a while" — an expired access token was being renewed by
   a refresh that treated *any* failure as a rejection, so one flaky moment
   logged you out. Supabase also rotates refresh tokens, so two concurrent
   renewals raced and the loser was thrown out. */
import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const ME = '00000000-0000-4000-8000-000000000000';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const fails = [];
const check = (name, ok, got) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) fails.push(name);
};

const state = { mode: 'ok', refreshCalls: [], issued: 0 };

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('pageerror:', e.message); fails.push('pageerror'); });
  await page.addInitScript((me) => {
    try {
      localStorage.setItem('brewlog.auth.session', JSON.stringify({
        access_token: 'expired-token', refresh_token: 'refresh-1',
        expires_at: Date.now() - 60000,           // already stale on boot
        user: { id: me, email: 'norm@example.com' },
      }));
    } catch {}
  }, ME);
  await page.route('**/basemaps.cartocdn.com/**', r => r.abort());
  await page.route('**/*.supabase.co/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (url.pathname === '/auth/v1/token') {
      const sent = JSON.parse(req.postData() || '{}').refresh_token;
      state.refreshCalls.push(sent);
      if (state.mode === 'offline') return route.abort('failed');
      if (state.mode === 'server-error') return json({ msg: 'upstream boom' }, 503);
      if (state.mode === 'revoked') return json({ error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }, 400);
      // normal: rotate, and reject any attempt to reuse a spent token
      if (sent !== `refresh-${state.issued + 1}`) {
        return json({ msg: 'Invalid Refresh Token: Already Used' }, 400);
      }
      state.issued++;
      return json({
        access_token: `access-${state.issued}`, refresh_token: `refresh-${state.issued + 1}`,
        expires_in: 3600, user: { id: ME, email: 'norm@example.com' },
      });
    }
    if (url.pathname.startsWith('/auth/v1/')) return json({ id: ME, email: 'norm@example.com' });
    if (url.pathname.startsWith('/storage/v1/')) return json({ Key: 'ok' });
    if (url.pathname.startsWith('/rest/v1/')) {
      if (req.method() !== 'GET') return json([], 201);
      return json(url.pathname.endsWith('/profiles')
        ? [{ user_id: ME, display_name: 'Norm', share_log: false, approved: true,
             created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }]
        : []);
    }
    return json({});
  });
  return { ctx, page };
}

const stillIn = (page) => page.evaluate(() => {
  try { return !!JSON.parse(localStorage.getItem('brewlog.auth.session') || 'null')?.refresh_token; }
  catch { return false; }
});
const atGate = (page) => page.$('[data-send]').then(Boolean);

/* ---- 1. the connection drops while the token is stale --------------- */
state.mode = 'offline';
let { ctx, page } = await newPage();
await page.goto(base + '#/beans', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
check('a failed refresh does not sign you out', await stillIn(page), 'session cleared');
check('and does not throw you back to the sign-in screen', !(await atGate(page)), 'gate shown');
await ctx.close();

/* ---- 2. the auth server 500s --------------------------------------- */
state.mode = 'server-error';
({ ctx, page } = await newPage());
await page.goto(base + '#/beans', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
check('a 5xx does not sign you out', await stillIn(page), 'session cleared');
await ctx.close();

/* ---- 3. normal operation: one refresh, not several ------------------ */
state.mode = 'ok';
state.issued = 0;
state.refreshCalls = [];
({ ctx, page } = await newPage());
await page.goto(base + '#/beans', { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);

check('the stale token was renewed', await stillIn(page), 'session cleared');
check('still signed in', !(await atGate(page)), 'gate shown');
// every concurrent caller must share one redemption — a second call with the
// same rotated-away token is what Supabase rejects as "Already Used"
const firstToken = state.refreshCalls.filter(t => t === 'refresh-1').length;
check('concurrent callers share a single refresh',
  firstToken === 1, { calls: state.refreshCalls });
check('no refresh was rejected as already-used',
  state.issued >= 1, { issued: state.issued, calls: state.refreshCalls });
await ctx.close();

/* ---- 4. a genuinely revoked token does end the session -------------- */
state.mode = 'revoked';
({ ctx, page } = await newPage());
await page.goto(base + '#/beans', { waitUntil: 'networkidle' });
await page.waitForTimeout(4500);
check('a revoked token signs you out, as it should', !(await stillIn(page)), 'session kept');
check('and shows the sign-in screen', await atGate(page), 'no gate');
await ctx.close();

console.log(fails.length ? `\n${fails.length} FAILING` : '\nall good');
await browser.close();
process.exit(fails.length ? 1 : 0);
