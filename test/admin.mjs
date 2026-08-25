/* Admin rights and new-user approval, from the app's side. The database is
   the real boundary (test/sql/rls.sql covers that); this checks the app
   agrees with it — and, importantly, that a project which has NOT run the
   new schema.sql keeps working exactly as before. */
import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const ADMIN = '00000000-0000-4000-8000-000000000001';
const MEMBER = '00000000-0000-4000-8000-000000000002';
const NEW = '00000000-0000-4000-8000-000000000003';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const fails = [];
const check = (name, ok, got) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) fails.push(name);
};

const bean = (id, user_id, name) => ({
  id, user_id, name, roaster: 'R', origin: 'Kenya', brew_method: 'Espresso',
  flavor_notes: [], ratings: { aromatics: 3, acidity: 3, sweetness: 3, aftertaste: 3, body: 3 },
  overall: 4, notes: '', image_url: '', deleted: false,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
});

let server;
const reset = (opts = {}) => {
  const flags = opts.migrated === false ? {} : { approved: true, is_admin: false };
  server = {
    beans: [bean('b-mine', ADMIN, 'My Bag'), bean('b-theirs', MEMBER, 'Their Bag')],
    cafes: [],
    profiles: [
      { user_id: ADMIN, display_name: 'Norm', share_log: true, ...flags,
        ...(opts.migrated === false ? {} : { is_admin: !!opts.admin }),
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
      { user_id: MEMBER, display_name: 'Micah', share_log: true, ...flags,
        created_at: '2026-01-02T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' },
    ],
    patches: [], upserts: [],
  };
  if (opts.pending) {
    server.profiles.push({
      user_id: NEW, display_name: 'Newcomer', share_log: false,
      approved: false, is_admin: false,
      created_at: '2026-02-01T00:00:00.000Z', updated_at: '2026-02-01T00:00:00.000Z',
    });
  }
};

async function open(as, hash = '#/beans') {
  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('pageerror:', e.message); fails.push('pageerror'); });
  await page.addInitScript((me) => {
    try {
      localStorage.setItem('brewlog.auth.session', JSON.stringify({
        access_token: 't', refresh_token: 'r', expires_at: Date.now() + 86400000,
        user: { id: me, email: 'x@example.com' },
      }));
      localStorage.setItem('brewlog.scope.beans', '1');
    } catch {}
  }, as);
  await page.route('**/basemaps.cartocdn.com/**', r => r.abort());
  await page.route('**/*.supabase.co/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.pathname.startsWith('/auth/v1/')) return json({ id: as, email: 'x@example.com' });
    if (url.pathname.startsWith('/storage/v1/')) return json({ Key: 'ok' });
    const table = url.pathname.replace('/rest/v1/', '');
    if (req.method() === 'GET') return json(server[table] || []);
    if (req.method() === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      const id = decodeURIComponent((url.searchParams.get('user_id') || '').replace(/^eq\./, ''));
      server.patches.push({ table, id, body });
      const row = server.profiles.find(p => p.user_id === id);
      if (row) Object.assign(row, body);
      return json([], 200);
    }
    server.upserts.push({ table, rows: JSON.parse(req.postData() || '[]') });
    return json([], 201);
  });
  await page.goto(base + hash, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  return { ctx, page };
}

/* ---- 1. a plain member cannot touch someone else's entry ------------ */
reset({ admin: false });
let { ctx, page } = await open(ADMIN, '#/bean/b-theirs');
check('a member sees a shared entry as read only',
  /read only/i.test(await page.textContent('.read-only-note').catch(() => '')),
  await page.textContent('.read-only-note').catch(() => 'no note'));
check('no edit button for a member', !(await page.$('[data-edit]')), 'edit shown');
check('no delete button for a member', !(await page.$('[data-del]')), 'delete shown');
await page.goto(base + '#/bean/b-theirs/edit', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
check('a member is bounced out of the editor', !/\/edit$/.test(page.url()), page.url());
check('no member list for a non-admin', !(await page.$('[data-members]')), 'shown');
await ctx.close();

/* ---- 2. an admin can correct anyone's entry ------------------------- */
reset({ admin: true });
({ ctx, page } = await open(ADMIN, '#/bean/b-theirs'));
check('an admin gets an edit button on a shared entry', !!(await page.$('[data-edit]')), 'missing');
check('the banner says it is an admin edit, not read-only',
  /as an admin/i.test(await page.textContent('.read-only-note').catch(() => '')),
  await page.textContent('.read-only-note').catch(() => ''));

await page.goto(base + '#/bean/b-theirs/edit', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
check('an admin reaches the editor', /\/edit$/.test(page.url()), page.url());
await page.fill('[data-f="name"]', 'Corrected By Admin');
await page.click('[data-save]');
await page.waitForTimeout(3000);

const pushed = server.upserts.flatMap(u => u.table === 'beans' ? u.rows : [])
  .filter(r => r.id === 'b-theirs');
check('the admin edit is pushed', pushed.length > 0 && pushed.at(-1).name === 'Corrected By Admin',
  pushed.map(r => r.name));
/* The row must stay theirs. Stamping the editor as owner would silently
   move the entry into the admin's own log. */
check('the entry still belongs to its owner',
  pushed.every(r => r.user_id === MEMBER), pushed.map(r => r.user_id));
await ctx.close();

/* ---- 3. approving a newcomer --------------------------------------- */
reset({ admin: true, pending: true });
({ ctx, page } = await open(ADMIN, '#/settings'));
check('the admin sees the member list', !!(await page.$('[data-members]')), 'missing');
check('the waiting count is shown',
  /1 waiting/.test(await page.textContent('[data-members]').then(() => page.content())), 'no count');
check('the newcomer has an Approve button', !!(await page.$(`[data-approve="${NEW}"]`)), 'missing');
check('an approved member has no Approve button', !(await page.$(`[data-approve="${MEMBER}"]`)), 'shown');
check('the admin cannot revoke themselves', !(await page.$(`[data-revoke="${ADMIN}"]`)), 'shown');

await page.click(`[data-approve="${NEW}"]`);
await page.waitForTimeout(2500);
const patch = server.patches.find(p => p.id === NEW);
check('approval is a PATCH of just that flag',
  patch?.table === 'profiles' && patch?.body?.approved === true && !('is_admin' in patch.body),
  patch);
await ctx.close();

/* ---- 4. the newcomer's own view ------------------------------------ */
reset({ admin: true, pending: true });
({ ctx, page } = await open(NEW, '#/beans'));
check('an unapproved account is told it is waiting',
  !!(await page.$('[data-recheck]')), await page.textContent('h1').catch(() => ''));
check('and gets no tab bar', await page.$eval('#tabbar', e => e.hidden) === true, 'visible');
check('and no bean list leaks through', !(await page.$('.bean-card')), 'cards shown');
await ctx.close();

/* ---- 5. a project that has not run the new schema is unaffected ----- */
reset({ migrated: false });
({ ctx, page } = await open(ADMIN, '#/beans'));
check('without the migration, nobody is locked out',
  !(await page.$('[data-recheck]')) && await page.$eval('#tabbar', e => e.hidden) === false,
  'gated');
check('and the app still lists beans', (await page.$$('.bean-card')).length > 0, 'empty');
await ctx.close();

console.log(fails.length ? `\n${fails.length} FAILING` : '\nall good');
await browser.close();
process.exit(fails.length ? 1 : 0);
