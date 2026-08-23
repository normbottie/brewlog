/* Bag photo -> uniform "studio" shot.

   Two paths:
   1. LOCAL (always available, offline, free): border flood-fill matting to
      cut the bag out of its background, then composite onto a consistent
      seamless backdrop with a contact shadow and reflection.
   2. API (optional, needs the user's own key): send the photo to an image
      model and ask for a real studio render.
*/

export const OUT_W = 1080;
export const OUT_H = 1350;          // 4:5

/* ================= helpers ================= */

export function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise(res => canvas.toBlob(b => res(b), type, quality));
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataURL) {
  const [head, b64] = dataURL.split(',');
  const mime = /:(.*?);/.exec(head)[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Downscale an image element onto a canvas, longest side <= max. */
function fit(img, max) {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

/* ================= background matting ================= */

/* Perceptual-ish distance: weight chroma more than luminance so a shadow
   falling on a wall still reads as "the wall". */
function dist(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  const dl = (dr + dg + db) / 3;
  const cr = dr - dl, cg = dg - dl, cb = db - dl;
  return Math.sqrt(dl * dl * 0.55 + (cr * cr + cg * cg + cb * cb) * 1.7);
}

/**
 * Flood fill inward from the image border, marking everything that stays
 * close to the local border colour as background. Returns a Uint8 alpha
 * mask (255 = subject).
 */
function buildMask(canvas, tolerance = 34) {
  const { width: w, height: h } = canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, w, h);

  const visited = new Uint8Array(w * h);
  const bg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let qh = 0, qt = 0;

  /* Each fill front carries two colours:
     - a slowly drifting local reference, so smooth wall gradients keep going
     - the fixed colour of the border pixel the chain started from, so the
       drift can never walk all the way onto the subject. */
  const refR = new Uint8Array(w * h);
  const refG = new Uint8Array(w * h);
  const refB = new Uint8Array(w * h);
  const orgR = new Uint8Array(w * h);
  const orgG = new Uint8Array(w * h);
  const orgB = new Uint8Array(w * h);

  const anchorTol = tolerance * 1.75;  // how far the wall may drift overall

  const push = (x, y, r, g, b) => {
    const i = y * w + x;
    if (visited[i]) return;
    visited[i] = 1;
    refR[i] = r; refG[i] = g; refB[i] = b;
    orgR[i] = r; orgG[i] = g; orgB[i] = b;
    queue[qt++] = i;
  };

  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      const p = (y * w + x) * 4;
      push(x, y, data[p], data[p + 1], data[p + 2]);
    }
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) {
      const p = (y * w + x) * 4;
      push(x, y, data[p], data[p + 1], data[p + 2]);
    }
  }

  while (qh < qt) {
    const i = queue[qh++];
    bg[i] = 1;
    const x = i % w, y = (i / w) | 0;
    const rr = refR[i], gg = refG[i], bb = refB[i];
    const or_ = orgR[i], og = orgG[i], ob = orgB[i];

    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (visited[ni]) continue;
      const p = ni * 4;
      const pr = data[p], pg = data[p + 1], pb = data[p + 2];
      if (dist(pr, pg, pb, rr, gg, bb) > tolerance) continue;
      if (dist(pr, pg, pb, or_, og, ob) > anchorTol) continue;
      visited[ni] = 1;
      refR[ni] = (rr * 7 + pr) >> 3;
      refG[ni] = (gg * 7 + pg) >> 3;
      refB[ni] = (bb * 7 + pb) >> 3;
      orgR[ni] = or_; orgG[ni] = og; orgB[ni] = ob;
      queue[qt++] = ni;
    }
  }

  // alpha = inverse of background
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = bg[i] ? 0 : 255;

  fillHoles(alpha, w, h);
  return alpha;
}

/** Close small background pockets fully enclosed by the subject. */
function fillHoles(alpha, w, h) {
  const seen = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  let qh = 0, qt = 0;
  const seed = (i) => { if (!seen[i] && alpha[i] === 0) { seen[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (qh < qt) {
    const i = q[qh++];
    const x = i % w, y = (i / w) | 0;
    if (x + 1 < w) seed(i + 1);
    if (x - 1 >= 0) seed(i - 1);
    if (y + 1 < h) seed(i + w);
    if (y - 1 >= 0) seed(i - w);
  }
  for (let i = 0; i < w * h; i++) if (alpha[i] === 0 && !seen[i]) alpha[i] = 255;
}

/** Box blur the mask for a feathered edge, then bias it inward a touch. */
function feather(alpha, w, h, radius = 2) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const d = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += alpha[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / d;
      const add = alpha[y * w + Math.min(w - 1, x + radius + 1)];
      const sub = alpha[y * w + Math.max(0, x - radius)];
      sum += add - sub;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / d;
      const add = tmp[Math.min(h - 1, y + radius + 1) * w + x];
      const sub = tmp[Math.max(0, y - radius) * w + x];
      sum += add - sub;
    }
  }
  const res = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    // pull the midpoint up so the halo of original background is trimmed
    const v = (out[i] / 255 - 0.42) / 0.58;
    res[i] = Math.max(0, Math.min(1, v)) * 255;
  }
  return res;
}

function bbox(alpha, w, h, thresh = 40) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > thresh) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* ================= backdrops ================= */

export const BACKDROPS = {
  espresso: {
    label: 'Espresso',
    paint(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#2A211B');
      g.addColorStop(0.52, '#1A1511');
      g.addColorStop(1, '#0D0B09');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      const pool = ctx.createRadialGradient(w * 0.5, h * 0.3, 0, w * 0.5, h * 0.3, w * 0.78);
      pool.addColorStop(0, 'rgba(214,180,133,0.20)');
      pool.addColorStop(0.55, 'rgba(160,120,80,0.07)');
      pool.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = pool;
      ctx.fillRect(0, 0, w, h);
    },
    shadow: 'rgba(0,0,0,0.62)',
    reflect: 0.13,
  },
  cream: {
    label: 'Cream',
    paint(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#EFE4D5');
      g.addColorStop(0.58, '#E2D2BE');
      g.addColorStop(1, '#CBB89F');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      const pool = ctx.createRadialGradient(w * 0.5, h * 0.26, 0, w * 0.5, h * 0.26, w * 0.8);
      pool.addColorStop(0, 'rgba(255,252,246,0.62)');
      pool.addColorStop(1, 'rgba(255,252,246,0)');
      ctx.fillStyle = pool;
      ctx.fillRect(0, 0, w, h);
    },
    shadow: 'rgba(90,66,44,0.34)',
    reflect: 0.1,
  },
  slate: {
    label: 'Slate',
    paint(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#28312F');
      g.addColorStop(0.55, '#1A2220');
      g.addColorStop(1, '#0E1312');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const pool = ctx.createRadialGradient(w * 0.5, h * 0.28, 0, w * 0.5, h * 0.28, w * 0.8);
      pool.addColorStop(0, 'rgba(180,205,196,0.16)');
      pool.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = pool;
      ctx.fillRect(0, 0, w, h);
    },
    shadow: 'rgba(0,0,0,0.58)',
    reflect: 0.14,
  },
};

function vignette(ctx, w, h, strength = 0.42) {
  const g = ctx.createRadialGradient(w / 2, h * 0.44, w * 0.22, w / 2, h * 0.5, w * 0.82);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/* ================= local studio composite ================= */

/**
 * @param {HTMLImageElement} img  the raw photo
 * @param {object} opts { backdrop, tolerance, cutout }
 * @returns {Promise<Blob>} jpeg at OUT_W x OUT_H
 */
export async function localStudio(img, opts = {}) {
  const backdrop = BACKDROPS[opts.backdrop] || BACKDROPS.espresso;
  const cutout = opts.cutout !== false;

  const out = document.createElement('canvas');
  out.width = OUT_W; out.height = OUT_H;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  backdrop.paint(ctx, OUT_W, OUT_H);

  const work = fit(img, 1100);
  const w = work.width, h = work.height;

  let subject = work;
  let box = { x: 0, y: 0, w, h };

  if (cutout) {
    let alpha = buildMask(work, opts.tolerance ?? 34);
    alpha = feather(alpha, w, h, 2);
    box = bbox(alpha, w, h) || box;

    // reject a mask that ate the whole frame or found nothing
    const covered = box.w * box.h / (w * h);
    if (covered > 0.985 || covered < 0.02) {
      subject = work;
      box = { x: 0, y: 0, w, h };
    } else {
      const wc = work.getContext('2d', { willReadFrequently: true });
      const id = wc.getImageData(0, 0, w, h);
      for (let i = 0; i < w * h; i++) id.data[i * 4 + 3] = alpha[i];
      const cut = document.createElement('canvas');
      cut.width = w; cut.height = h;
      cut.getContext('2d').putImageData(id, 0, 0);
      subject = cut;
    }
  }

  /* --- place the subject consistently in frame --- */
  const padX = OUT_W * 0.15;
  const topPad = OUT_H * 0.085;
  const bottomPad = OUT_H * 0.175;      // room for the shadow + reflection
  const availW = OUT_W - padX * 2;
  const availH = OUT_H - topPad - bottomPad;
  const scale = Math.min(availW / box.w, availH / box.h);
  const dw = box.w * scale;
  const dh = box.h * scale;
  const dx = (OUT_W - dw) / 2;
  const dy = topPad + (availH - dh) / 2;
  const baseY = dy + dh;

  /* --- contact shadow --- */
  ctx.save();
  ctx.translate(OUT_W / 2, baseY + dh * 0.018);
  ctx.scale(1, 0.15);
  const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, dw * 0.62);
  sg.addColorStop(0, backdrop.shadow);
  sg.addColorStop(0.45, backdrop.shadow.replace(/[\d.]+\)$/, '0.22)'));
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(0, 0, dw * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  /* --- reflection --- */
  if (backdrop.reflect > 0) {
    ctx.save();
    ctx.globalAlpha = backdrop.reflect;
    ctx.translate(0, baseY * 2 + dh * 0.01);
    ctx.scale(1, -1);
    ctx.drawImage(subject, box.x, box.y, box.w, box.h, dx, dy, dw, dh);
    ctx.restore();
    // fade the reflection out
    const fade = ctx.createLinearGradient(0, baseY, 0, baseY + dh * 0.34);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = fade;
    ctx.fillRect(0, baseY, OUT_W, dh * 0.4);
    ctx.restore();
    // repaint what we punched out of the backdrop below the fade line
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    backdrop.paint(ctx, OUT_W, OUT_H);
    ctx.restore();
  }

  /* --- the bag --- */
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = OUT_W * 0.045;
  ctx.shadowOffsetY = OUT_H * 0.012;
  ctx.drawImage(subject, box.x, box.y, box.w, box.h, dx, dy, dw, dh);
  ctx.restore();

  vignette(ctx, OUT_W, OUT_H, opts.backdrop === 'cream' ? 0.16 : 0.4);

  return canvasToBlob(out, 'image/jpeg', 0.92);
}

/** Simple uniform crop with no cutout — the safe fallback. */
export async function plainFrame(img, backdropKey = 'espresso') {
  return localStudio(img, { backdrop: backdropKey, cutout: false });
}

/* ================= API studio render ================= */

const LS_PROVIDER = 'brewlog.img.provider';
const LS_KEY = 'brewlog.img.key';
const LS_MODEL = 'brewlog.img.model';

export const PROVIDERS = {
  gemini: { label: 'Google Gemini', defaultModel: 'gemini-2.5-flash-image' },
  openai: { label: 'OpenAI', defaultModel: 'gpt-image-1' },
};

export function getImageAPIConfig() {
  try {
    const provider = localStorage.getItem(LS_PROVIDER) || 'gemini';
    const key = (localStorage.getItem(LS_KEY) || '').trim();
    const model = (localStorage.getItem(LS_MODEL) || '').trim() || PROVIDERS[provider].defaultModel;
    return key ? { provider, key, model } : null;
  } catch { return null; }
}

export function setImageAPIConfig(provider, key, model) {
  try {
    localStorage.setItem(LS_PROVIDER, provider);
    localStorage.setItem(LS_KEY, (key || '').trim());
    localStorage.setItem(LS_MODEL, (model || '').trim());
  } catch {}
}

export function clearImageAPIConfig() {
  try { [LS_PROVIDER, LS_KEY, LS_MODEL].forEach(k => localStorage.removeItem(k)); } catch {}
}

export const hasImageAPI = () => !!getImageAPIConfig();

export const STUDIO_PROMPT =
  'Re-photograph this exact coffee bag as a premium studio product shot. ' +
  'Keep the bag, its label artwork, all text and the packaging shape completely unchanged and legible — ' +
  'do not invent, redraw, translate or alter any text. ' +
  'Stand the bag upright, centred, shot straight on at eye level, filling most of the frame. ' +
  'Place it on a seamless dark warm-brown backdrop with soft top-left key lighting, ' +
  'a gentle falloff to near-black at the corners, and a soft contact shadow beneath the bag. ' +
  'Clean, minimal, high-end coffee-roaster catalogue look. Vertical 4:5 framing. No props, no text overlays, no watermark.';

async function geminiRender(cfg, blob) {
  const dataURL = await blobToDataURL(blob);
  const b64 = dataURL.split(',')[1];
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: STUDIO_PROMPT },
            { inline_data: { mime_type: blob.type || 'image/jpeg', data: b64 } },
          ],
        }],
      }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Gemini error ${res.status}`);
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inline_data || p.inlineData);
  if (!imgPart) {
    const txt = parts.find(p => p.text)?.text;
    throw new Error(txt ? `Model returned text, not an image: ${txt.slice(0, 120)}` : 'No image in response');
  }
  const inline = imgPart.inline_data || imgPart.inlineData;
  return dataURLToBlob(`data:${inline.mime_type || inline.mimeType || 'image/png'};base64,${inline.data}`);
}

async function openaiRender(cfg, blob) {
  const fd = new FormData();
  fd.append('model', cfg.model);
  fd.append('image', blob, 'bag.jpg');
  fd.append('prompt', STUDIO_PROMPT);
  fd.append('size', '1024x1536');
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.key}` },
    body: fd,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI error ${res.status}`);
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image in response');
  return dataURLToBlob(`data:image/png;base64,${b64}`);
}

/** Render via the configured API, then normalise to OUT_W x OUT_H. */
export async function apiStudio(img, rawBlob) {
  const cfg = getImageAPIConfig();
  if (!cfg) throw new Error('No image API key configured');

  // send a reasonably sized copy, not the full 12MP phone photo
  const small = fit(img, 1024);
  const send = await canvasToBlob(small, 'image/jpeg', 0.88);

  const result = cfg.provider === 'openai'
    ? await openaiRender(cfg, send)
    : await geminiRender(cfg, send);

  const rendered = await fileToImage(result);
  const out = document.createElement('canvas');
  out.width = OUT_W; out.height = OUT_H;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // cover-crop to 4:5 so every card matches
  const s = Math.max(OUT_W / rendered.width, OUT_H / rendered.height);
  const dw = rendered.width * s, dh = rendered.height * s;
  ctx.drawImage(rendered, (OUT_W - dw) / 2, (OUT_H - dh) / 2, dw, dh);
  void rawBlob;
  return canvasToBlob(out, 'image/jpeg', 0.92);
}
