/* Bag photo -> uniform "studio" shot.

   Two paths:
   1. LOCAL (always available, offline, free): border flood-fill matting to
      cut the bag out of its background, then composite onto a consistent
      seamless backdrop with a contact shadow and reflection.
   2. API (optional, needs the user's own key): send the photo to an image
      model and ask for a real studio render.
*/

import { accessToken } from './auth.js';
import { getConfig as supabaseConfig } from './supabase.js';
import { GEMINI_PROXY } from './config.js';

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
  white: {
    label: 'White',
    prompt: 'a seamless pure-white studio sweep, brightly and evenly lit',
    paint(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#FFFFFF');
      g.addColorStop(0.62, '#F4F1EC');
      g.addColorStop(1, '#DFD8CE');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    shadow: 'rgba(90,78,66,0.30)',
    reflect: 0.08,
  },
  espresso: {
    label: 'Espresso',
    prompt: 'a seamless dark warm-brown studio backdrop falling off to near-black at the corners',
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
    prompt: 'a seamless warm cream-coloured studio backdrop',
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
    prompt: 'a seamless dark slate-grey studio backdrop',
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

/** The actual photo, cover-cropped to the shared 4:5 frame. Nothing added. */
export async function plainFrame(img) {
  const out = document.createElement('canvas');
  out.width = OUT_W; out.height = OUT_H;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const s = Math.max(OUT_W / img.width, OUT_H / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, (OUT_W - dw) / 2, (OUT_H - dh) / 2, dw, dh);
  return canvasToBlob(out, 'image/jpeg', 0.92);
}

/* ================= API studio render ================= */

const LS_PROVIDER = 'brewlog.img.provider';
const LS_KEY = 'brewlog.img.key';
const LS_MODEL = 'brewlog.img.model';

/* All Gemini traffic goes through here: a personal key talks to Google
   directly; otherwise the request is routed through the gemini-proxy Edge
   Function, which injects the shared key server-side. */
async function geminiFetch(path, init = {}) {
  const local = getImageAPIConfig();
  if (local?.key && local.provider !== 'openai') {
    return fetch('https://generativelanguage.googleapis.com' + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': local.key, ...(init.headers || {}) },
    });
  }
  if (!GEMINI_PROXY) throw new Error('Add an image API key in Settings');
  const cfg = supabaseConfig();
  const tok = await accessToken();
  if (!cfg || !tok) throw new Error('Sign in to use AI features');
  return fetch(`${cfg.url}/functions/v1/gemini-proxy?path=${encodeURIComponent(path)}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tok}`,
      apikey: cfg.key,
      ...(init.headers || {}),
    },
  });
}

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-3.1-flash-image',
    // cheapest first; all are "Nano Banana" image models
    models: ['gemini-3.1-flash-lite-image', 'gemini-3.1-flash-image', 'gemini-3-pro-image'],
  },
  openai: { label: 'OpenAI', defaultModel: 'gpt-image-1', models: ['gpt-image-1'] },
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

export const hasImageAPI = () => !!getImageAPIConfig() || GEMINI_PROXY;

export const STUDIO_PROMPT = [
  'Re-photograph this exact coffee bag as a clean e-commerce product shot.',
  '',
  'FIDELITY IS THE PRIORITY. This is a photograph of a real product, not a design task.',
  'Reproduce the packaging exactly as it appears in the source image: every word, letter,',
  'number, logo, illustration, colour and its position on the bag must match the original.',
  'Do NOT invent, add, remove, re-letter, re-spell, translate, re-typeset, restyle or',
  '"improve" any text or graphic. Do not add roaster names, origins, weights, dates,',
  'tasting notes, barcodes or badges that are not already visible. If part of the label is',
  'blurred, cropped or unreadable in the source, reproduce it as-is rather than guessing —',
  'never fabricate legible text where the original is illegible.',
  '',
  'CAMERA: a three-quarter product view. The bag stands upright on a flat surface, rotated',
  'roughly 25-35 degrees so the full front face reads clearly and one side gusset is visible',
  'along the left edge. Slightly above eye level, straight vertical edges, no fisheye or',
  'dramatic perspective. Centred, filling most of the frame with even margins.',
  '',
  'THE SIDE GUSSET IS THE ONE EXCEPTION to reproducing the packaging exactly: leave it',
  'completely blank. Omit every graphic and every word printed on that side panel —',
  'brewing instructions, icons, QR codes, contact details, URLs, legal text, all of it.',
  'Render the side panel as one clean, flat, unbroken block of colour sampled from the',
  'adjacent solid colour of the bag, shaded naturally by the lighting. Do not replace the',
  'side print with different text, placeholder lettering, a logo or a pattern. The front',
  'face keeps all of its original artwork and text, unchanged.',
  '',
  'LIGHTING AND BACKGROUND: place the bag on {{BACKDROP}}. Soft, even, diffused light',
  'from the upper left, gentle highlights along the bag edges, and a soft contact shadow',
  'directly beneath the bag. Crisp focus edge to edge.',
  '',
  'Vertical 4:5 framing. No props, no hands, no reflections of other objects, no text',
  'overlays, no watermark, no border.',
].join(' ');

/** The studio prompt with the chosen backdrop substituted in. */
export function studioPrompt(backdropKey = 'white') {
  const bd = BACKDROPS[backdropKey] || BACKDROPS.white;
  return STUDIO_PROMPT.replace('{{BACKDROP}}', bd.prompt || BACKDROPS.white.prompt);
}

export const READ_LABEL_PROMPT = [
  'Read this photograph of a coffee bag and transcribe what is printed on it.',
  'Return ONLY a JSON object, no prose and no markdown fence, with exactly these keys:',
  '"name" (the coffee/blend name, e.g. "Old Skool" or "Kirinyaga AB"),',
  '"roaster" (the company/brand name),',
  '"origin" (country of origin),',
  '"region" (region, farm, co-op or producer),',
  '"process" (one of Washed, Natural, Honey, Anaerobic, Wet-Hulled, Carbonic Maceration, Other),',
  '"varietal", "roast_level" (one of Light, Medium-Light, Medium, Medium-Dark, Dark),',
  '"roast_date" (YYYY-MM-DD), "weight_g" (net weight in grams, digits only),',
  '"flavor_notes" (array of short tasting-note strings printed on the bag),',
  '"brew_method" (only if the bag explicitly names one, e.g. "Espresso").',
  '',
  'Transcribe only what is actually legible on the packaging. Use null for anything not',
  'printed on the bag or that you cannot read with confidence — do not infer, guess or',
  'fill in from general knowledge of the roaster. An empty array is fine for flavor_notes.',
  'If the weight is printed in ounces, convert to grams and round to the nearest whole number.',
].join(' ');

/* Google has moved image generation from `models/{m}:generateContent` to the
   Interactions API, and the response shape differs between them (and has
   already changed once). Rather than hard-code a path through the JSON, walk
   the whole response for the first node that looks like image bytes. */
function findImageData(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const v of node) {
      const hit = findImageData(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const inline = node.inline_data || node.inlineData || node.output_image || node.outputImage;
  if (inline && typeof inline.data === 'string') {
    return { data: inline.data, mime: inline.mime_type || inline.mimeType || 'image/png' };
  }
  // Interactions-style: { type: "image", mime_type, data }
  if (typeof node.data === 'string' && node.data.length > 512 &&
      (node.type === 'image' || node.mime_type || node.mimeType)) {
    return { data: node.data, mime: node.mime_type || node.mimeType || 'image/png' };
  }
  for (const v of Object.values(node)) {
    const hit = findImageData(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function findText(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return '';
  if (Array.isArray(node)) return node.map(v => findText(v, depth + 1)).find(Boolean) || '';
  if (typeof node.text === 'string' && node.text.trim()) return node.text;
  for (const v of Object.values(node)) {
    const hit = findText(v, depth + 1);
    if (hit) return hit;
  }
  return '';
}

/* A known-good shot to anchor the look. Describing a backdrop and a camera
   angle in words gets you somewhere near; showing an example gets renders
   that actually sit together in the grid. Shipped small (~33 KB) because it
   rides along with every render request. */
const STYLE_REF_URL = './assets/style-reference.jpg';
let styleRefPromise = null;

function styleReference() {
  if (!styleRefPromise) {
    styleRefPromise = (async () => {
      const res = await fetch(STYLE_REF_URL);
      if (!res.ok) throw new Error(`reference ${res.status}`);
      const blob = await res.blob();
      return {
        mime: blob.type || 'image/jpeg',
        data: (await blobToDataURL(blob)).split(',')[1],
      };
    })().catch(() => null);   // a missing reference is not worth failing over
  }
  return styleRefPromise;
}

/* The reference is a different roaster's bag, so the danger is obvious: the
   model borrowing its label instead of its lighting. Say so plainly. */
const STYLE_REF_NOTE = [
  'You are given TWO images.',
  '',
  'IMAGE 1 IS A STYLE REFERENCE ONLY, and it shows a DIFFERENT product. Match it for:',
  'backdrop colour and its soft gradient, the direction and softness of the light, the',
  'camera angle and height, how much of the frame the bag fills, where it sits in the',
  'frame, and the contact shadow beneath it.',
  '',
  'Take NOTHING else from image 1. Its brand, its label, its wording, its colours, its',
  'illustration and its bag shape must not appear in your output in any form. If you',
  'find yourself reproducing any text visible in image 1, you have made a mistake.',
  '',
  'IMAGE 2 IS THE SUBJECT: the actual bag being photographed. Every detail of the',
  'product itself — shape, colour, label, artwork and all of its text — comes from',
  'image 2 and only from image 2.',
].join(' ');

const REF_LABEL_1 = 'IMAGE 1 — style reference. Copy its lighting, backdrop and framing. Do not copy its product or any of its text.';
const REF_LABEL_2 = 'IMAGE 2 — the bag to photograph. Reproduce this product exactly.';

async function geminiRender(model, blob, prompt) {
  const b64 = (await blobToDataURL(blob)).split(',')[1];
  const mime = blob.type || 'image/jpeg';
  const ref = await styleReference();
  const fullPrompt = ref ? `${prompt}\n\n${STYLE_REF_NOTE}` : prompt;

  /* 1. Interactions API — current path for the Nano Banana models. */
  let firstError = '';
  try {
    const input = [{ type: 'text', text: fullPrompt }];
    if (ref) {
      input.push({ type: 'text', text: REF_LABEL_1 });
      input.push({ type: 'image', mime_type: ref.mime, data: ref.data });
      input.push({ type: 'text', text: REF_LABEL_2 });
    }
    input.push({ type: 'image', mime_type: mime, data: b64 });

    const res = await geminiFetch('/v1beta/interactions', {
      method: 'POST',
      body: JSON.stringify({ model, input }),
    });
    const json = await res.json();
    if (res.ok) {
      const hit = findImageData(json);
      if (hit) return dataURLToBlob(`data:${hit.mime};base64,${hit.data}`);
      const txt = findText(json);
      throw new Error(txt ? `Model replied with text, not an image: ${txt.slice(0, 140)}`
                          : 'No image in the response');
    }
    firstError = json?.error?.message || `Gemini error ${res.status}`;
    // 4xx that isn't "endpoint/model unknown" is a real failure — don't retry
    if (res.status !== 404 && res.status !== 400) throw new Error(firstError);
  } catch (err) {
    if (firstError && err.message === firstError) throw err;
    if (!firstError) firstError = err.message || 'Interactions request failed';
    if (/text, not an image|No image in the response/.test(err.message || '')) throw err;
  }

  /* 2. Legacy generateContent — still works for gemini-2.5-flash-image. */
  const parts = [{ text: fullPrompt }];
  if (ref) {
    parts.push({ text: REF_LABEL_1 });
    parts.push({ inline_data: { mime_type: ref.mime, data: ref.data } });
    parts.push({ text: REF_LABEL_2 });
  }
  parts.push({ inline_data: { mime_type: mime, data: b64 } });

  const res = await geminiFetch(`/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || firstError || `Gemini error ${res.status}`);
  }
  const hit = findImageData(json);
  if (hit) return dataURLToBlob(`data:${hit.mime};base64,${hit.data}`);
  const txt = findText(json);
  throw new Error(txt ? `Model replied with text, not an image: ${txt.slice(0, 140)}`
                      : 'No image in the response');
}

async function openaiRender(cfg, blob, prompt) {
  const fd = new FormData();
  fd.append('model', cfg.model);
  fd.append('image', blob, 'bag.jpg');
  fd.append('prompt', prompt);
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

/* ================= read the label ================= */

/* Google renames and retires these faster than any hard-coded default can
   keep up with, so ask the key which models it actually has and cache the
   answer. The list below is only the fallback when that call fails. */
const GEMINI_READ_FALLBACKS = [
  'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash',
  'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-2.5-flash',
];
const LS_READ_MODEL = 'brewlog.img.readmodel';

function scoreReadModel(id) {
  if (!/^gemini-/.test(id)) return -1;
  // these can't do image-in / text-out
  if (/image|imagen|tts|audio|embedding|aqa|live|veo|robotics/.test(id)) return -1;
  const version = parseFloat((/gemini-(\d+(?:\.\d+)?)/.exec(id) || [])[1] || '0');
  if (!version) return -1;
  let score = version * 10;
  if (/flash-lite/.test(id)) score += 6;        // cheapest that can still read a label
  else if (/flash/.test(id)) score += 4;
  else if (/pro/.test(id)) score += 1;          // works, but overkill and pricier
  else return -1;
  if (/preview|exp|latest|\d{3}$/.test(id)) score -= 8;   // prefer stable, pinned ids
  return score;
}

/** Ask the key what it can use for reading a label; cached in localStorage. */
async function pickReadModel() {   // routes through geminiFetch, so needs no cfg
  try {
    const cached = localStorage.getItem(LS_READ_MODEL);
    if (cached) return cached;
  } catch {}

  try {
    const res = await geminiFetch('/v1beta/models?pageSize=200');
    if (res.ok) {
      const json = await res.json();
      const usable = (json.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => String(m.name || '').replace(/^models\//, ''))
        .map(id => ({ id, score: scoreReadModel(id) }))
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score);
      if (usable.length) {
        try { localStorage.setItem(LS_READ_MODEL, usable[0].id); } catch {}
        return usable[0].id;
      }
    }
  } catch { /* fall through to the static list */ }

  return GEMINI_READ_FALLBACKS[0];
}

export function forgetReadModel() {
  try { localStorage.removeItem(LS_READ_MODEL); } catch {}
}

const READ_MODELS = { openai: 'gpt-4.1-mini' };

function parseLabelJSON(text) {
  if (!text) throw new Error('The model returned nothing');
  const cleaned = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('Could not read the label');
  const raw = JSON.parse(cleaned.slice(start, end + 1));

  const clean = (v) => {
    if (v == null) return '';
    const s = String(v).trim();
    return /^(null|n\/a|none|unknown|not visible)$/i.test(s) ? '' : s;
  };
  return {
    name: clean(raw.name),
    roaster: clean(raw.roaster),
    origin: clean(raw.origin),
    region: clean(raw.region),
    process: clean(raw.process),
    varietal: clean(raw.varietal),
    roast_level: clean(raw.roast_level),
    roast_date: /^\d{4}-\d{2}-\d{2}$/.test(clean(raw.roast_date)) ? clean(raw.roast_date) : '',
    weight_g: clean(raw.weight_g).replace(/[^\d]/g, ''),
    brew_method: clean(raw.brew_method),
    flavor_notes: Array.isArray(raw.flavor_notes)
      ? raw.flavor_notes.map(clean).filter(Boolean).slice(0, 8)
      : [],
  };
}

/**
 * Transcribe the bag's label into form fields. Needs an API key.
 * @returns {Promise<object>} partial bean fields; '' for anything unreadable
 */
export async function readBagLabel(img) {
  const cfg = getImageAPIConfig();
  if (!cfg && !GEMINI_PROXY) throw new Error('Add an image API key in Settings to read labels');

  const small = fit(img, 1024);
  const blob = await canvasToBlob(small, 'image/jpeg', 0.9);
  const b64 = (await blobToDataURL(blob)).split(',')[1];

  /* cfg is null whenever the shared proxy is supplying the key, which is
     the normal case for an invited user — optional-chain like apiStudio
     does, or reading a label throws before it ever reaches the network. */
  if (cfg?.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: READ_MODELS.openai,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: READ_LABEL_PROMPT },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
          ],
        }],
        response_format: { type: 'json_object' },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || `OpenAI error ${res.status}`);
    return parseLabelJSON(json?.choices?.[0]?.message?.content);
  }

  /* Try the discovered model, then each fallback, across both endpoints.
     A "model not found" is worth retrying with another name; anything else
     (bad key, quota, safety block) is reported straight away. */
  const discovered = await pickReadModel();
  const candidates = [discovered, ...GEMINI_READ_FALLBACKS.filter(m => m !== discovered)];
  let lastErr = null;

  for (const model of candidates) {
    for (const endpoint of ['interactions', 'generateContent']) {
      let res, json;
      try {
        if (endpoint === 'interactions') {
          res = await geminiFetch('/v1beta/interactions', {
            method: 'POST',
            body: JSON.stringify({
              model,
              input: [
                { type: 'text', text: READ_LABEL_PROMPT },
                { type: 'image', mime_type: 'image/jpeg', data: b64 },
              ],
            }),
          });
        } else {
          res = await geminiFetch(`/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: READ_LABEL_PROMPT },
                  { inline_data: { mime_type: 'image/jpeg', data: b64 } },
                ],
              }],
              generationConfig: { responseMimeType: 'application/json' },
            }),
          });
        }
        json = await res.json();
      } catch (err) {
        lastErr = err;
        continue;
      }

      if (res.ok) {
        // remember what worked so the next read skips straight to it
        try { localStorage.setItem(LS_READ_MODEL, model); } catch {}
        return parseLabelJSON(findText(json));
      }

      const msg = json?.error?.message || `Gemini error ${res.status}`;
      lastErr = new Error(msg);
      // unknown model or unsupported method — try the next name
      if (/not found|not supported|unsupported|unknown/i.test(msg) || res.status === 404) continue;
      if (res.status === 400 && endpoint === 'interactions') continue;
      throw lastErr;   // real failure: bad key, quota, blocked content
    }
  }

  forgetReadModel();
  throw new Error(
    (lastErr?.message || 'No usable model') +
    ' — none of the models your key offers accepted the request.'
  );
}

/** Render via the configured API, then normalise to OUT_W x OUT_H. */
export const RENDER_BACKDROP = 'espresso';

export async function apiStudio(img, opts = {}) {
  const cfg = getImageAPIConfig();
  if (!cfg && !GEMINI_PROXY) throw new Error('No image API key configured');
  const prompt = studioPrompt(opts.backdrop || RENDER_BACKDROP);

  // send a reasonably sized copy, not the full 12MP phone photo
  const small = fit(img, 1024);
  const send = await canvasToBlob(small, 'image/jpeg', 0.88);

  const result = cfg?.provider === 'openai'
    ? await openaiRender(cfg, send, prompt)
    : await geminiRender(cfg?.model || PROVIDERS.gemini.defaultModel, send, prompt);

  const rendered = await fileToImage(result);
  const out = document.createElement('canvas');
  out.width = OUT_W; out.height = OUT_H;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // cover-crop to 4:5 so every card matches
  const s = Math.max(OUT_W / rendered.width, OUT_H / rendered.height);
  const dw = rendered.width * s, dh = rendered.height * s;
  ctx.drawImage(rendered, (OUT_W - dw) / 2, (OUT_H - dh) / 2, dw, dh);
  return canvasToBlob(out, 'image/jpeg', 0.92);
}
