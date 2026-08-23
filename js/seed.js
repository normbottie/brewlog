/* Sample data — useful for trying the app before you've photographed anything.
   The "photos" are drawn on a canvas and then pushed through the real
   studio pipeline, so what you see is what your own photos will look like. */

import { saveBean, saveCafe, blankBean, blankCafe, setBeanImage } from './store.js';
import { localStudio, fileToImage } from './imaging.js';

const BEANS = [
  {
    name: 'Kirinyaga AB', roaster: 'Onyx Coffee Lab', origin: 'Kenya', region: 'Kirinyaga',
    process: 'Washed', varietal: 'SL28, SL34', roast_level: 'Light', brew_method: 'V60',
    grind: '22g in, 360g out, 2:45', price: '24.00', weight_g: '250',
    flavor_notes: ['blackcurrant', 'grapefruit', 'cane sugar'],
    ratings: { aromatics: 4, acidity: 5, sweetness: 4, aftertaste: 5, body: 3 },
    overall: 5,
    notes: 'Startlingly bright. The blackcurrant is not a tasting-note cliché here — it is just there, front and centre. Best at 94°C; hotter and the acidity turns sharp.',
    bag: { body: '#1E4034', accent: '#D8B98C', label: '#F3EADC' },
  },
  {
    name: 'Gedeb Worka', roaster: 'Tim Wendelboe', origin: 'Ethiopia', region: 'Yirgacheffe',
    process: 'Natural', varietal: 'Heirloom', roast_level: 'Light', brew_method: 'AeroPress',
    grind: '15g, 200g water, 2:00', price: '21.50', weight_g: '250',
    flavor_notes: ['strawberry', 'jasmine', 'peach'],
    ratings: { aromatics: 5, acidity: 4, sweetness: 5, aftertaste: 4, body: 3 },
    overall: 5,
    notes: 'The aroma off the grinder is the best part of my morning. Syrupy as it cools.',
    bag: { body: '#7A3B2E', accent: '#E8C89A', label: '#FAF2E6' },
  },
  {
    name: 'Monarch Espresso', roaster: 'Counter Culture', origin: 'Blend', region: 'Colombia · Brazil',
    process: 'Washed', varietal: 'Caturra, Bourbon', roast_level: 'Medium-Dark', brew_method: 'Espresso',
    grind: '18g in, 38g out, 28s', price: '18.00', weight_g: '340',
    flavor_notes: ['dark chocolate', 'toffee', 'baked apple'],
    ratings: { aromatics: 3, acidity: 2, sweetness: 4, aftertaste: 4, body: 5 },
    overall: 4,
    notes: 'Forgiving. Holds up in milk without going flat. My default when I do not want to think about it.',
    bag: { body: '#2A1D18', accent: '#C9A87C', label: '#EDE0CC' },
  },
  {
    name: 'La Esperanza', roaster: 'Sey Coffee', origin: 'Colombia', region: 'Huila',
    process: 'Honey', varietal: 'Pink Bourbon', roast_level: 'Medium-Light', brew_method: 'Drip',
    grind: '60g/L, medium', price: '26.00', weight_g: '200',
    flavor_notes: ['red apple', 'honey', 'almond'],
    ratings: { aromatics: 4, acidity: 3, sweetness: 5, aftertaste: 4, body: 4 },
    overall: 4,
    notes: 'Very round. Less dramatic than the Kenya but I reached for it more often, which probably says something.',
    bag: { body: '#B4644A', accent: '#3C2A20', label: '#FFF6E8' },
  },
  {
    name: 'Cold Brew Reserve', roaster: 'Blue Bottle', origin: 'Peru', region: 'Cajamarca',
    process: 'Washed', varietal: 'Typica', roast_level: 'Medium', brew_method: 'Cold Brew',
    grind: 'Coarse, 16h', price: '19.00', weight_g: '340',
    flavor_notes: ['cocoa', 'molasses', 'hazelnut'],
    ratings: { aromatics: 3, acidity: 2, sweetness: 4, aftertaste: 3, body: 5 },
    overall: 3,
    notes: 'Does exactly one job well. Heavy body, almost no acid. Fine over ice, dull hot.',
    bag: { body: '#3F5B6B', accent: '#E4C79A', label: '#F0F4F6' },
  },
];

const CAFES = [
  { name: 'Sey Coffee', address: '18 Grattan St, Brooklyn, NY', lat: 40.7069, lng: -73.9339, rating: 5,
    notes: 'Bright room, long communal table. Ask what is on the single-origin espresso — it changes weekly and it is always the right order.' },
  { name: 'Devoción', address: '69 Grand St, Brooklyn, NY', lat: 40.7154, lng: -73.9617, rating: 4,
    notes: 'The skylight makes it. Colombia-only, very fresh. Gets loud after 11am on weekends.' },
  { name: 'Abraço', address: '81 E 7th St, New York, NY', lat: 40.7268, lng: -73.9847, rating: 5,
    notes: 'Tiny, standing room. Cortado and an olive cake. Cash used to be a thing — check.' },
  { name: 'Variety Coffee', address: '146 Wyckoff Ave, Brooklyn, NY', lat: 40.7060, lng: -73.9214, rating: 3,
    notes: 'Reliable rather than exciting. Good for working — outlets, and nobody rushes you.' },
];

/** Draw a plausible "phone photo of a bag against a wall". */
function drawBagPhoto({ body, accent, label }, name, roaster) {
  const W = 900, H = 1200;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  // wall + surface, so the matting has a real background to find
  const wall = ctx.createLinearGradient(0, 0, W * 0.3, H);
  wall.addColorStop(0, '#CFC6BA');
  wall.addColorStop(1, '#AFA598');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#9C9184';
  ctx.fillRect(0, H * 0.79, W, H * 0.21);

  // bag body with a gusset highlight
  const bx = W * 0.235, by = H * 0.16, bw = W * 0.53, bh = H * 0.63;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  ctx.fillStyle = body;
  roundRect(ctx, bx, by, bw, bh, 14);
  ctx.fill();
  ctx.restore();

  const sheen = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  sheen.addColorStop(0, 'rgba(0,0,0,.18)');
  sheen.addColorStop(0.22, 'rgba(255,255,255,.11)');
  sheen.addColorStop(0.55, 'rgba(255,255,255,.02)');
  sheen.addColorStop(1, 'rgba(0,0,0,.22)');
  ctx.fillStyle = sheen;
  roundRect(ctx, bx, by, bw, bh, 14);
  ctx.fill();

  // top seam
  ctx.fillStyle = 'rgba(0,0,0,.24)';
  ctx.fillRect(bx, by, bw, H * 0.022);

  // label block
  const lx = bx + bw * 0.12, ly = by + bh * 0.2, lw = bw * 0.76, lh = bh * 0.44;
  ctx.fillStyle = label;
  roundRect(ctx, lx, ly, lw, lh, 8);
  ctx.fill();

  ctx.fillStyle = accent;
  ctx.fillRect(lx, ly + lh * 0.2, lw, 3);

  ctx.fillStyle = '#2A211B';
  ctx.textAlign = 'center';
  ctx.font = `600 ${Math.round(lw * 0.075)}px -apple-system, system-ui, sans-serif`;
  ctx.fillText((roaster || '').toUpperCase().slice(0, 20), lx + lw / 2, ly + lh * 0.14);
  ctx.font = `700 ${Math.round(lw * 0.125)}px -apple-system, system-ui, sans-serif`;
  wrapText(ctx, name, lx + lw / 2, ly + lh * 0.42, lw * 0.88, lw * 0.15);
  ctx.fillStyle = accent;
  ctx.font = `600 ${Math.round(lw * 0.062)}px -apple-system, system-ui, sans-serif`;
  ctx.fillText('SINGLE ORIGIN · 250g', lx + lw / 2, ly + lh * 0.85);

  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = String(text).split(' ');
  let line = '';
  const lines = [];
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineH));
}

function toBlob(canvas) {
  return new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.92));
}

export async function seedDemoData() {
  let n = 0;

  for (const spec of BEANS) {
    const bean = { ...blankBean(), ...spec };
    delete bean.bag;
    bean.roast_date = new Date(Date.now() - Math.random() * 26 * 864e5).toISOString().slice(0, 10);
    await saveBean(bean);

    const photo = drawBagPhoto(spec.bag, spec.name, spec.roaster);
    const rawBlob = await toBlob(photo);
    const img = await fileToImage(rawBlob);
    const studio = await localStudio(img, { backdrop: 'espresso' });
    await setBeanImage(bean.id, studio, rawBlob);
    n++;
  }

  for (const spec of CAFES) {
    await saveCafe({ ...blankCafe(), ...spec });
    n++;
  }

  return n;
}
