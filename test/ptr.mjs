import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 414, height: 896 }, hasTouch: true });
page.on('pageerror', e => console.log('pageerror:', e.message));
await page.goto('http://localhost:8899/index.html#/beans', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const r = await page.evaluate(() => {
  const mk = (type, y) => {
    const t = new Touch({ identifier: 1, target: document.body, clientX: 200, clientY: y });
    document.dispatchEvent(new TouchEvent(type, {
      touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true,
    }));
  };
  mk('touchstart', 100);
  mk('touchmove', 180);
  const midShown = document.getElementById('ptr').classList.contains('show');
  mk('touchmove', 290);
  const armed = document.getElementById('ptr').classList.contains('armed');
  // do NOT fire touchend at armed distance or the page reloads mid-test
  mk('touchmove', 120);
  mk('touchend', 120);
  const hidden = !document.getElementById('ptr').classList.contains('show');
  return { midShown, armed, hidden };
});
console.log(r);
await browser.close();
