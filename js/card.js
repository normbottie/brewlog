/* Share card — a bean drawn onto a canvas and handed over as a PNG.

   Everything is drawn, nothing is screenshotted: the app's own layout is full
   of glass and blur that no canvas can reproduce, and a 1080×1350 portrait is
   what actually reads on a phone screen once it's been sent to someone. */

import { AXES, AXIS_LABELS, beanImageURL } from './store.js';
import { h, esc, sheet, toast } from './ui.js';

const W = 1080;
const H = 1350;
const PAD = 76;

const FONT = '-apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif';
const C = {
  bg: '#100D0B',
  text: '#F6EEE4',
  muted: '#B4A392',
  faint: '#7C6D5E',
  crema: '#D8B98C',
  tan: '#C9A87C',
  tanBright: '#E4C79A',
};

const STAR_PATH =
  'M12 2.6l2.85 5.94 6.4.9-4.64 4.6 1.11 6.5L12 17.48 6.28 20.54l1.1-6.5-4.63-4.6 6.4-.9z';

/* ---- little canvas helpers ----------------------------------------- */

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Break text to fit `max` px, at most `lines` lines, ellipsising the last. */
function wrap(ctx, text, max, lines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= max || !line) { line = next; continue; }
    out.push(line);
    line = word;
    if (out.length === lines) break;
  }
  if (out.length < lines && line) out.push(line);
  if (out.length === lines) {
    let last = out[lines - 1];
    const rest = words.join(' ');
    const shown = out.join(' ');
    if (shown.length < rest.length) {
      while (last && ctx.measureText(last + '…').width > max) last = last.slice(0, -1);
      out[lines - 1] = last + '…';
    }
  }
  return out;
}

function drawStars(ctx, value, cx, y, size) {
  const gap = size * 0.18;
  const total = 5 * size + 4 * gap;
  let x = cx - total / 2;
  const path = new Path2D(STAR_PATH);
  for (let i = 1; i <= 5; i++) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 24, size / 24);
    ctx.fillStyle = i <= value ? C.tanBright : 'rgba(246,238,228,0.16)';
    ctx.fill(path);
    ctx.restore();
    x += size + gap;
  }
}

/** Cover-crop an image into a box, the way object-fit: cover does. */
function drawCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = src;
  });
}

/* ---- the card ------------------------------------------------------- */

function drawBackground(ctx) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  // the app's ambient warmth, flattened into two radial washes
  const warm = ctx.createRadialGradient(W * 0.12, -60, 0, W * 0.12, -60, W * 0.95);
  warm.addColorStop(0, 'rgba(190,131,74,0.34)');
  warm.addColorStop(1, 'rgba(190,131,74,0)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, W, H);
  const green = ctx.createRadialGradient(W * 0.5, H * 1.05, 0, W * 0.5, H * 1.05, W * 0.9);
  green.addColorStop(0, 'rgba(40,84,70,0.30)');
  green.addColorStop(1, 'rgba(40,84,70,0)');
  ctx.fillStyle = green;
  ctx.fillRect(0, 0, W, H);
}

/* The photo is faded out, not covered over. Painting a background-coloured
   gradient on top would leave a hard seam where the flat paint met the
   ambient wash below it; erasing the photo's own pixels lets the background
   show through unbroken. */
function drawPhoto(ctx, img, bean, top, height) {
  const layer = document.createElement('canvas');
  layer.width = W;
  layer.height = height;
  const lc = layer.getContext('2d');

  if (img) {
    drawCover(lc, img, 0, 0, W, height);
  } else {
    // no photo on this device: a warm plate with the initial, not a hole
    const g = lc.createLinearGradient(0, 0, W, height);
    g.addColorStop(0, '#33281F');
    g.addColorStop(1, '#1A1411');
    lc.fillStyle = g;
    lc.fillRect(0, 0, W, height);
    lc.fillStyle = 'rgba(228,199,154,0.20)';
    lc.font = `600 300px ${FONT}`;
    lc.textAlign = 'center';
    lc.textBaseline = 'middle';
    lc.fillText((bean.name || bean.roaster || '?').trim().charAt(0).toUpperCase(),
      W / 2, height * 0.42);
  }

  const fade = lc.createLinearGradient(0, height * 0.42, 0, height);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.72, 'rgba(0,0,0,0.85)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  lc.globalCompositeOperation = 'destination-out';
  lc.fillStyle = fade;
  lc.fillRect(0, height * 0.42, W, height * 0.58);

  ctx.drawImage(layer, 0, top);
}

function drawRadar(ctx, ratings, cx, cy, R) {
  const n = AXES.length;
  const angle = (i) => (-90 + i * (360 / n)) * (Math.PI / 180);
  const pt = (i, r) => [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r];
  const trace = (r) => {
    ctx.beginPath();
    AXES.forEach((_, i) => {
      const [x, y] = pt(i, r);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
  };

  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(255,240,220,0.13)';
  for (let k = 1; k <= 5; k++) { trace((R * k) / 5); ctx.stroke(); }

  ctx.strokeStyle = 'rgba(255,240,220,0.10)';
  AXES.forEach((_, i) => {
    const [x, y] = pt(i, R);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
  });

  const vals = AXES.map(a => {
    const v = Number(ratings?.[a]);
    return Number.isFinite(v) ? Math.max(0, Math.min(5, v)) : 0;
  });
  ctx.beginPath();
  vals.forEach((v, i) => {
    const [x, y] = pt(i, (R * v) / 5);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = 'rgba(201,168,124,0.32)';
  ctx.fill();
  ctx.strokeStyle = C.tan;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.fillStyle = C.tanBright;
  vals.forEach((v, i) => {
    const [x, y] = pt(i, (R * v) / 5);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawAxisBars(ctx, ratings, x, y, w) {
  const rowH = 54;
  ctx.textBaseline = 'alphabetic';
  AXES.forEach((a, i) => {
    const top = y + i * rowH;
    ctx.font = `500 27px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = C.muted;
    ctx.fillText(AXIS_LABELS[a], x, top + 10);

    const v = Math.max(0, Math.min(5, Number(ratings?.[a]) || 0));
    ctx.font = `600 27px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = C.text;
    ctx.fillText(v.toFixed(1), x + w, top + 10);

    const barY = top + 24;
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    roundRect(ctx, x, barY, w, 8, 4);
    ctx.fill();
    if (v > 0) {
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, 'rgba(201,168,124,0.55)');
      g.addColorStop(1, C.tanBright);
      ctx.fillStyle = g;
      roundRect(ctx, x, barY, Math.max(8, (w * v) / 5), 8, 4);
      ctx.fill();
    }
  });
  return y + AXES.length * rowH;
}

function drawChips(ctx, notes, y) {
  if (!notes.length) return y;
  ctx.font = `500 28px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const h = 52;
  const padX = 24;
  const gap = 14;
  let x = PAD;
  let drawn = 0;
  for (const note of notes) {
    const w = ctx.measureText(note).width + padX * 2;
    if (x + w > W - PAD) break;            // one line only — the card is not a list
    ctx.fillStyle = 'rgba(255,244,230,0.075)';
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,234,210,0.14)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = C.crema;
    ctx.fillText(note, x + padX, y + h / 2 + 1);
    x += w + gap;
    drawn++;
  }
  ctx.textBaseline = 'alphabetic';
  return drawn ? y + h : y;
}

/**
 * Draw the card.
 * @returns {Promise<Blob>} PNG
 */
export async function beanCardBlob(bean, { cafe = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  /* Only ever draw from a local blob. A remote URL would taint the canvas
     and toBlob() would throw at the very end, after all the work. */
  let img = null;
  try {
    const url = await beanImageURL(bean);
    if (url && url.startsWith('blob:')) img = await loadImage(url);
  } catch { /* the card stands without the photo */ }

  drawBackground(ctx);

  /* The title is measured before anything is drawn: a name that wraps to two
     lines pushes everything below it down, and the photo is what gives way —
     otherwise the flavour chips end up under the footer. */
  ctx.font = `700 62px ${FONT}`;
  const nameLines = wrap(ctx, bean.name || 'Untitled', W - PAD * 2, 2);
  const photoH = nameLines.length > 1 ? 620 : 700;

  drawPhoto(ctx, img, bean, 0, photoH);

  let y = photoH - 120;

  ctx.textAlign = 'left';
  ctx.fillStyle = C.text;
  nameLines.forEach(line => { ctx.fillText(line, PAD, y); y += 72; });

  if (bean.roaster) {
    ctx.font = `500 34px ${FONT}`;
    ctx.fillStyle = C.tan;
    ctx.fillText(wrap(ctx, bean.roaster, W - PAD * 2, 1)[0] || '', PAD, y + 6);
    y += 46;
  }

  const sub = [bean.origin, bean.process, bean.roast_level].filter(Boolean).join(' · ');
  if (sub) {
    ctx.font = `400 29px ${FONT}`;
    ctx.fillStyle = C.faint;
    ctx.fillText(wrap(ctx, sub, W - PAD * 2, 1)[0] || '', PAD, y + 4);
    y += 42;
  }

  if (bean.overall) {
    drawStars(ctx, bean.overall, PAD + 5 * 22, y + 18, 40);
    y += 62;
  }

  y += 26;

  /* Radar on the left, the same numbers spelled out on the right — the shape
     is the thing you recognise, the bars are the thing you can read. */
  const radarR = 148;
  const radarCX = PAD + radarR + 22;
  const radarCY = y + radarR + 10;
  drawRadar(ctx, bean.ratings, radarCX, radarCY, radarR);
  const barsX = radarCX + radarR + 74;
  const barsBottom = drawAxisBars(ctx, bean.ratings, barsX, y + 12, W - PAD - barsX);
  y = Math.max(radarCY + radarR + 30, barsBottom + 16);

  y = drawChips(ctx, (bean.flavor_notes || []).slice(0, 4), y + 6) + 34;

  /* footer */
  const footY = H - 62;
  ctx.font = `600 28px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = C.tan;
  ctx.fillText('Brewlog', PAD, footY);

  const where = [cafe?.name, bean.brew_method].filter(Boolean).join(' · ');
  if (where) {
    ctx.font = `400 27px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = C.faint;
    ctx.fillText(wrap(ctx, where, W * 0.6, 1)[0] || '', W - PAD, footY);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not render the card'))), 'image/png');
  });
}

/* ---- handing it over ------------------------------------------------ */

const fileName = (bean) => {
  const base = [bean.roaster, bean.name].filter(Boolean).join(' - ') || 'bean';
  return base.replace(/[^\w\s.-]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.png';
};

/**
 * Render the card and offer it: download, plus the iOS share sheet where the
 * browser supports handing over files. The preview is not decoration — on iOS
 * a long press on a real <img> is the reliable route into Photos.
 */
/* The download link and the long-press-to-save gesture both need the object
   URL to stay alive for as long as the sheet is on screen, and there is no
   reliable "the user finished saving" event. So the URL outlives the sheet
   and is only released when the next card replaces it. */
let lastCardURL = null;

export async function shareBeanCard(bean, opts = {}) {
  const blob = await beanCardBlob(bean, opts);
  const name = fileName(bean);
  if (lastCardURL) URL.revokeObjectURL(lastCardURL);
  const url = URL.createObjectURL(blob);
  lastCardURL = url;

  const file = (typeof File === 'function') ? new File([blob], name, { type: 'image/png' }) : null;
  const canShare = !!(file && navigator.canShare?.({ files: [file] }));

  sheet('Share card', (close) => {
    const node = h(`<div>
      <img src="${url}" alt="Share card for ${esc(bean.name || 'this bean')}"
           style="width:100%;border-radius:var(--radius-md);display:block;margin-bottom:16px">
      <div class="stack">
        ${canShare ? '<button class="btn-primary btn-block" data-share>Share…</button>' : ''}
        <a class="btn btn-block ${canShare ? '' : 'btn-primary'}" download="${esc(name)}" href="${url}"
           style="text-align:center">Save the image</a>
      </div>
      <div class="hint" style="margin-top:12px;text-align:center">
        On iPhone you can also press and hold the picture to save it to Photos.
      </div>
    </div>`);

    node.querySelector('[data-share]')?.addEventListener('click', async () => {
      try {
        await navigator.share({ files: [file] });
        close();
      } catch (err) {
        if (err?.name !== 'AbortError') toast('Sharing was not available');
      }
    });
    return node;
  });

  return blob;
}
