import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = '/root/brewlog/test/shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
page.on('pageerror', e => console.log('pageerror:', e.message));

await page.goto('http://localhost:8899/index.html', { waitUntil: 'networkidle' });

const results = await page.evaluate(async () => {
  const { localStudio, fileToImage } = await import('./js/imaging.js');
  const seed = await import('./js/seed.js');
  void seed;

  // rebuild the same synthetic photo the seeder uses, via a fresh import
  const mod = await import('./js/seed.js');
  void mod;

  // draw one directly here so we control the specimen
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function photo(bodyColor) {
    const W = 900, H = 1200;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const wall = ctx.createLinearGradient(0, 0, W * 0.3, H);
    wall.addColorStop(0, '#CFC6BA');
    wall.addColorStop(1, '#AFA598');
    ctx.fillStyle = wall; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#9C9184'; ctx.fillRect(0, H * 0.79, W, H * 0.21);
    const bx = W * 0.235, by = H * 0.16, bw = W * 0.53, bh = H * 0.63;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16;
    ctx.fillStyle = bodyColor;
    roundRect(ctx, bx, by, bw, bh, 14); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#F3EADC';
    roundRect(ctx, bx + bw * 0.12, by + bh * 0.2, bw * 0.76, bh * 0.44, 8); ctx.fill();
    return c;
  }

  const out = {};
  for (const [name, color] of [['green', '#1E4034'], ['dark', '#2A1D18'], ['red', '#B4644A']]) {
    const c = photo(color);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    const img = await fileToImage(blob);
    const studio = await localStudio(img, { backdrop: 'espresso' });
    out[name] = await new Promise(r => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result);
      fr.readAsDataURL(studio);
    });
    out[name + '_src'] = c.toDataURL('image/jpeg', 0.8);
  }
  return out;
});

for (const [k, v] of Object.entries(results)) {
  fs.writeFileSync(`${OUT}/img-${k}.jpg`, Buffer.from(v.split(',')[1], 'base64'));
}
console.log('wrote', Object.keys(results).join(', '));
await browser.close();
