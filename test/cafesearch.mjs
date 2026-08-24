/* Café search: the map must show the area that was actually searched, and
   you must be able to find a place you haven't rated yet. Overpass and
   Nominatim are stubbed so this tests our wiring, not their uptime. */
import { chromium } from 'playwright';

const base = 'http://localhost:8899/index.html';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
const page = await ctx.newPage();
const errs = [];
await page.addInitScript(() => {
  try {
    localStorage.setItem('brewlog.auth.session', JSON.stringify({
      access_token: 'test-token', refresh_token: 'r',
      expires_at: Date.now() + 86400000,
      user: { id: '00000000-0000-4000-8000-000000000000', email: 'test@example.com' },
    }));
  } catch {}
});
page.on('pageerror', e => errs.push('pageerror: ' + e.message));

const fails = [];
const check = (name, ok, got) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) fails.push(name);
};

// blank map tiles: no network in here, and they'd only slow things down
await page.route('**/basemaps.cartocdn.com/**', r => r.abort());

// Overpass: one café ~2km north of centre, i.e. inside the 2400m ring
await page.route('**/interpreter**', r => r.fulfill({
  contentType: 'application/json',
  body: JSON.stringify({ elements: [
    { type: 'node', id: 1, lat: 40.7308, lon: -74.006,
      tags: { name: 'Stub Roasters', amenity: 'cafe', 'addr:street': 'Test St' } },
  ] }),
}));

// Nominatim: a place the user has definitely not rated
await page.route('**/nominatim.openstreetmap.org/search**', r => r.fulfill({
  contentType: 'application/json',
  body: JSON.stringify([
    { lat: '40.7180', lon: '-74.0100', name: 'Unrated Coffee Bar',
      display_name: 'Unrated Coffee Bar, 5 Elm St, New York, NY',
      category: 'amenity', type: 'cafe',
      address: { house_number: '5', road: 'Elm St', city: 'New York', state: 'NY' } },
    { lat: '40.9000', lon: '-74.2000', name: 'Unrated Bagels',
      display_name: 'Unrated Bagels, Nowhere', category: 'shop', type: 'bakery', address: {} },
  ]),
}));

// seed, so the list has cafés of its own and the filter path is reachable
await page.goto(base + '#/settings', { waitUntil: 'networkidle' });
await page.click('[data-seed]');
await page.waitForTimeout(7000);

await page.goto(base + '#/cafes', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

/* --- 1. search area is shown, and the map fits it ------------------- */
// zoom right in first, so a search that ignored zoom would be obvious
await page.evaluate(() => window.__map = null);
await page.click('[data-here]');
await page.waitForTimeout(2500);

const status = await page.$eval('[data-nearstatus]', e => e.textContent.trim());
check('status names the searched radius', /1\.5 mi/.test(status) && /circled area/.test(status), status);

const ring = await page.$$eval('#map path', els => els.length);
check('a search ring is drawn on the map', ring > 0, ring);

// the ring must be visible, not cropped: its bounds inside the map's
const fits = await page.evaluate(() => {
  const box = document.querySelector('#map').getBoundingClientRect();
  const p = document.querySelector('#map path').getBoundingClientRect();
  return { ok: p.width > 40 && p.width <= box.width + 2 && p.height <= box.height + 2,
           ring: Math.round(p.width), map: Math.round(box.width) };
});
check('the whole search radius is in view', fits.ok, fits);

const sheetTitle = await page.$eval('.sheet-head h3', e => e.textContent.trim());
check('nearby sheet lists the hit', /1 café nearby/.test(sheetTitle), sheetTitle);
await page.click('.sheet-close');
await page.waitForTimeout(400);

/* --- 2. look up a café you haven't rated ---------------------------- */
check('no lookup button before typing',
  await page.$$eval('[data-osm]', e => e.length) === 0, 'button present');

await page.fill('[data-q]', 'Unrated Coffee');
await page.waitForTimeout(400);

const emptyMsg = await page.$eval('[data-list]', e => e.textContent.trim());
check('empty state points at the lookup', /haven.t rated this one yet/i.test(emptyMsg), emptyMsg);

const btnText = await page.$eval('[data-osm]', e => e.textContent.trim());
check('lookup button quotes the query', /Unrated Coffee/.test(btnText), btnText);

await page.click('[data-osm]');
await page.waitForTimeout(2000);

const t2 = await page.$eval('.sheet-head h3', e => e.textContent.trim());
check('sheet titled for the query', /Matches for/.test(t2) && /Unrated Coffee/.test(t2), t2);

const names = await page.$$eval('.sheet-body .cafe-row .nm', els => els.map(e => e.textContent.trim()));
check('cafés rank above bakeries', names[0] === 'Unrated Coffee Bar', names);

const addr = await page.$$eval('.sheet-body .cafe-row .addr', els => els[0].textContent.trim());
check('address is built from parts, not the raw display name',
  addr === '5 Elm St, New York, NY', addr);

// tapping it should open the add sheet, pre-filled
await page.click('.sheet-body .cafe-row');
await page.waitForTimeout(900);
const seeded = await page.$eval('[data-n]', e => e.value);
const seededAddr = await page.$eval('[data-a]', e => e.value);
check('add sheet is pre-filled with the place', seeded === 'Unrated Coffee Bar', seeded);
check('add sheet carries the address', /Elm St/.test(seededAddr), seededAddr);

console.log('\nerrors:', errs.length ? errs.join('\n') : 'none');
console.log(fails.length ? `\n${fails.length} FAILING` : '\nall good');
await browser.close();
process.exit(fails.length || errs.length ? 1 : 0);
