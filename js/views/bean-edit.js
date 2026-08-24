/* Add / edit a bean: photograph the bag, rate it, save. */

import {
  getBean, saveBean, blankBean, setBeanImage, beanImageURL, beanRawBlob, isForeign,
  AXES, AXIS_LABELS, BREW_METHODS, ROAST_LEVELS, PROCESSES,
} from '../store.js';
import { h, esc, icon, stars, bindStars, toast, bindRange, goReplace } from '../ui.js';
import { radarSVG } from '../radar.js';
import {
  fileToImage, plainFrame, apiStudio, readBagLabel, hasImageAPI,
} from '../imaging.js';

const fmtR = (v) => Number(v ?? 0).toFixed(1);

export async function render(root, id) {
  const isNew = !id;
  const bean = isNew ? blankBean() : structuredClone(await getBean(id));
  if (!bean) { location.hash = '#/beans'; return; }
  if (!isNew && isForeign(bean)) {   // shared entries are read-only
    toast('That entry belongs to another member');
    goReplace(`#/bean/${id}`);
    return;
  }
  bean.ratings = { ...{ aromatics: 3, acidity: 3, sweetness: 3, aftertaste: 3, body: 3 }, ...(bean.ratings || {}) };

  /* image working state */
  let rawImg = null;      // HTMLImageElement of the original photo
  let rawBlob = null;
  let chosen = null;      // Blob to save
  const variants = {};    // { plain, ai } -> { blob, url }
  let selected = null;

  const view = h(`<div>
    <div class="topbar">
      <button class="icon-btn" data-back aria-label="Back">${icon('back')}</button>
      <div>
        <h1>${isNew ? 'New bag' : 'Edit'}</h1>
        <div class="sub">${isNew ? 'Log a coffee' : esc(bean.name || 'Untitled')}</div>
      </div>
    </div>
    <div class="view">

      <div class="capture-frame glass" data-capture>
        <div class="placeholder">
          ${icon('camera')}
          <div style="font-weight:600;color:var(--text-muted)">Photograph the bag</div>
          <div class="hint" style="margin-top:4px">Take a clear photo of the front of the bag</div>
        </div>
        <img data-preview hidden alt="">
      </div>
      <input type="file" accept="image/*" capture="environment" hidden data-file>

      <div data-imgtools hidden style="margin-top:13px">
        <div class="thumb-row" data-variants></div>
        <div data-imgstatus class="hint" style="margin-top:10px"></div>
        <button class="btn-block" data-read style="margin-top:11px">
          ${icon('sparkle')} Read the label
        </button>
        <div data-readstatus class="hint" style="margin-top:8px"></div>
        <button class="btn-sm btn-block" data-retake style="margin-top:11px">Retake photo</button>
      </div>

      <h2 class="section">The coffee</h2>
      <div class="glass card-pad">
        <div class="field">
          <label for="f-name">Name</label>
          <input id="f-name" data-f="name" placeholder="e.g. Kirinyaga AB" value="${esc(bean.name)}">
        </div>
        <div class="field">
          <label for="f-roaster">Roaster</label>
          <input id="f-roaster" data-f="roaster" placeholder="e.g. Onyx Coffee Lab" value="${esc(bean.roaster)}">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="f-origin">Origin</label>
            <input id="f-origin" data-f="origin" placeholder="Ethiopia" value="${esc(bean.origin)}">
          </div>
          <div class="field">
            <label for="f-region">Region / farm</label>
            <input id="f-region" data-f="region" placeholder="Guji" value="${esc(bean.region)}">
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="f-process">Process</label>
            <select id="f-process" data-f="process">
              <option value="">—</option>
              ${PROCESSES.map(p => `<option ${p === bean.process ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="f-roastlevel">Roast</label>
            <select id="f-roastlevel" data-f="roast_level">
              <option value="">—</option>
              ${ROAST_LEVELS.map(p => `<option ${p === bean.roast_level ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="f-varietal">Varietal</label>
            <input id="f-varietal" data-f="varietal" placeholder="Heirloom" value="${esc(bean.varietal)}">
          </div>
          <div class="field">
            <label for="f-roastdate">Roast date</label>
            <input id="f-roastdate" type="date" data-f="roast_date" value="${esc(bean.roast_date)}">
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="f-price">Price</label>
            <input id="f-price" data-f="price" inputmode="decimal" placeholder="22.00" value="${esc(bean.price)}">
          </div>
          <div class="field" style="margin-bottom:0">
            <label for="f-weight">Weight (g)</label>
            <input id="f-weight" data-f="weight_g" inputmode="numeric" placeholder="250" value="${esc(bean.weight_g)}">
          </div>
        </div>
      </div>

      <h2 class="section">How you brewed it</h2>
      <div class="glass card-pad">
        <div class="seg" data-brew>
          ${BREW_METHODS.map(m =>
            `<button type="button" data-brewm="${esc(m)}" aria-pressed="${m === bean.brew_method}">${esc(m)}</button>`).join('')}
        </div>
        <div class="field" style="margin:15px 0 0">
          <label for="f-grind">Grind / recipe</label>
          <input id="f-grind" data-f="grind" placeholder="18g in, 38g out, 27s" value="${esc(bean.grind)}">
        </div>
      </div>

      <h2 class="section">Tasting profile</h2>
      <div class="glass radar-wrap" data-radar>${radarSVG(bean.ratings)}</div>
      <div class="glass card-pad" style="margin-top:12px">
        ${AXES.map(a => `<div class="slider-row">
          <div class="lbl">${AXIS_LABELS[a]}</div>
          <input type="range" min="0" max="5" step="0.1" value="${bean.ratings[a]}" data-axis="${a}"
                 aria-label="${AXIS_LABELS[a]}">
          <div class="val" data-axisval="${a}">${fmtR(bean.ratings[a])}</div>
        </div>`).join('')}
      </div>

      <h2 class="section">Overall</h2>
      <div class="glass card-pad" style="text-align:center">
        <div data-overall>${stars(bean.overall, { size: 'lg', interactive: true })}</div>
      </div>

      <h2 class="section">Flavour notes</h2>
      <div class="glass card-pad">
        <input data-f="flavor_notes" placeholder="blackcurrant, jasmine, brown sugar"
               value="${esc((bean.flavor_notes || []).join(', '))}">
        <div class="hint">Comma separated.</div>
      </div>

      <h2 class="section">Notes</h2>
      <div class="glass card-pad">
        <textarea data-f="notes" placeholder="What stood out? How did it change as it rested?">${esc(bean.notes)}</textarea>
      </div>

      <div style="height:20px"></div>
      <button class="btn-primary btn-block" data-save>${isNew ? 'Save bag' : 'Save changes'}</button>
      <div style="height:8px"></div>
    </div>
  </div>`);

  /* ---------- image capture ---------- */

  const fileInput = view.querySelector('[data-file]');
  const frame = view.querySelector('[data-capture]');
  const preview = view.querySelector('[data-preview]');
  const tools = view.querySelector('[data-imgtools]');
  const varRow = view.querySelector('[data-variants]');
  const status = view.querySelector('[data-imgstatus]');

  frame.onclick = () => fileInput.click();
  view.querySelector('[data-retake]').onclick = (e) => { e.stopPropagation(); fileInput.click(); };

  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      rawBlob = file;
      rawImg = await fileToImage(file);
      showPreview(URL.createObjectURL(file));
      tools.hidden = false;
      Object.keys(variants).forEach(k => delete variants[k]);
      await buildVariants();
    } catch (err) {
      toast(err.message || 'Could not read that photo');
    }
  };

  function showPreview(url) {
    preview.src = url;
    preview.hidden = false;
    frame.querySelector('.placeholder').hidden = true;
  }

  async function buildVariants() {
    status.innerHTML = `<span class="busy"><span class="spinner"></span>Framing…</span>`;
    paintVariants();
    try {
      variants.plain = { blob: await plainFrame(rawImg) };
      variants.plain.url = URL.createObjectURL(variants.plain.blob);
      if (!selected || selected === 'plain') select('plain');
      else paintVariants();
      paintVariants();
      status.textContent = hasImageAPI()
        ? 'Tap “AI studio” for a studio product shot of the bag.'
        : 'Add an image API key in Settings for a studio render.';
    } catch (err) {
      status.textContent = 'Could not process that photo. ' + (err.message || '');
      paintVariants();
    }
  }

  function paintVariants() {
    const opts = [];
    if (variants.saved) opts.push({ k: 'saved', label: 'Current' });
    opts.push({ k: 'plain', label: 'Photo' });
    if (hasImageAPI()) opts.push({ k: 'ai', label: 'AI studio' });

    varRow.innerHTML = opts.map(o => {
      const v = variants[o.k];
      const inner = v
        ? `<img src="${v.url}" alt="${o.label}">`
        : `<div style="aspect-ratio:4/5;display:grid;place-items:center;color:var(--text-faint);font-size:12px">
             ${o.k === 'ai' ? 'Tap to render' : '<span class="spinner"></span>'}</div>`;
      return `<button type="button" class="thumb-opt glass" data-v="${o.k}"
                aria-pressed="${selected === o.k}">${inner}<div class="cap">${o.label}</div></button>`;
    }).join('');
  }

  varRow.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    const k = b.dataset.v;
    if (k === 'ai' && !variants.ai) { await runAI(); return; }
    if (variants[k]) select(k);
    paintVariants();
  });

  function select(k) {
    selected = k;
    chosen = variants[k]?.blob || null;   // null for 'saved' = leave the image as it is
    if (variants[k]) showPreview(variants[k].url);
    varRow.querySelectorAll('[data-v]').forEach(x =>
      x.setAttribute('aria-pressed', String(x.dataset.v === selected)));
  }

  async function runAI() {
    if (!rawImg) {
      status.textContent = 'The original photo is not on this device — retake it to re-render.';
      return;
    }
    status.innerHTML = `<span class="busy"><span class="spinner"></span>Rendering the studio shot — this takes 10–30s…</span>`;
    try {
      const blob = await apiStudio(rawImg);
      variants.ai = { blob, url: URL.createObjectURL(blob) };
      select('ai');
      paintVariants();
      status.textContent = 'Studio render ready.';
    } catch (err) {
      status.textContent = 'AI render failed: ' + (err.message || 'unknown error');
      paintVariants();
    }
  }

  /* ---------- read the label ---------- */

  const readStatus = view.querySelector('[data-readstatus]');
  view.querySelector('[data-read]').onclick = async (e) => {
    if (!rawImg) { toast('Take a photo first'); return; }
    if (!hasImageAPI()) {
      readStatus.textContent = 'Needs an API key — add one in Settings (a fraction of a cent per read).';
      return;
    }
    const btn = e.currentTarget;
    btn.disabled = true;
    readStatus.innerHTML = `<span class="busy"><span class="spinner"></span>Reading the bag…</span>`;
    try {
      const found = await readBagLabel(rawImg);
      const filled = applyExtracted(found);
      readStatus.textContent = filled.length
        ? `Filled in ${filled.join(', ')}. Check it against the bag before saving.`
        : 'Nothing legible found on the label.';
    } catch (err) {
      readStatus.textContent = 'Could not read it: ' + (err.message || 'unknown error');
    } finally {
      btn.disabled = false;
    }
  };

  /** Write extracted values into empty fields only — never clobber your typing. */
  function applyExtracted(found) {
    const filled = [];
    const setField = (key, value, label) => {
      if (!value) return;
      const el = view.querySelector(`[data-f="${key}"]`);
      if (!el || el.value.trim()) return;
      el.value = value;
      filled.push(label || key);
    };
    setField('name', found.name, 'name');
    setField('roaster', found.roaster, 'roaster');
    setField('origin', found.origin, 'origin');
    setField('region', found.region, 'region');
    setField('varietal', found.varietal, 'varietal');
    setField('roast_date', found.roast_date, 'roast date');
    setField('weight_g', found.weight_g, 'weight');

    // selects: only accept a value the dropdown actually offers
    for (const [key, list, label] of [['process', PROCESSES, 'process'],
                                      ['roast_level', ROAST_LEVELS, 'roast']]) {
      const el = view.querySelector(`[data-f="${key}"]`);
      const hit = list.find(o => o.toLowerCase() === String(found[key] || '').toLowerCase());
      if (el && !el.value && hit) { el.value = hit; filled.push(label); }
    }

    const notesEl = view.querySelector('[data-f="flavor_notes"]');
    if (notesEl && !notesEl.value.trim() && found.flavor_notes.length) {
      notesEl.value = found.flavor_notes.join(', ');
      filled.push('flavour notes');
    }

    const brew = BREW_METHODS.find(m => m.toLowerCase() === String(found.brew_method || '').toLowerCase());
    if (brew) {
      bean.brew_method = brew;
      view.querySelectorAll('[data-brewm]').forEach(x =>
        x.setAttribute('aria-pressed', String(x.dataset.brewm === brew)));
      filled.push('brew method');
    }
    return filled;
  }

  /* ---------- form wiring ---------- */

  view.querySelector('[data-brew]').addEventListener('click', e => {
    const b = e.target.closest('[data-brewm]');
    if (!b) return;
    bean.brew_method = b.dataset.brewm;
    view.querySelectorAll('[data-brewm]').forEach(x =>
      x.setAttribute('aria-pressed', String(x.dataset.brewm === bean.brew_method)));
  });

  const radarBox = view.querySelector('[data-radar]');
  view.querySelectorAll('[data-axis]').forEach(inp => {
    bindRange(inp);
    inp.addEventListener('input', () => {
      const a = inp.dataset.axis;
      bean.ratings[a] = Math.round(Number(inp.value) * 10) / 10;
      view.querySelector(`[data-axisval="${a}"]`).textContent = fmtR(bean.ratings[a]);
      radarBox.innerHTML = radarSVG(bean.ratings);
    });
  });

  const overallBox = view.querySelector('[data-overall]');
  bindStars(overallBox, v => {
    bean.overall = bean.overall === v ? 0 : v;
    overallBox.innerHTML = stars(bean.overall, { size: 'lg', interactive: true });
  });

  view.querySelector('[data-back]').onclick = () =>
    history.length > 1 ? history.back() : (location.hash = '#/beans');

  view.querySelector('[data-save]').onclick = async (e) => {
    const btn = e.currentTarget;
    view.querySelectorAll('[data-f]').forEach(inp => {
      const f = inp.dataset.f;
      if (f === 'flavor_notes') {
        bean.flavor_notes = inp.value.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        bean[f] = inp.value;
      }
    });
    if (!bean.name.trim() && !bean.roaster.trim()) {
      toast('Give it a name or a roaster first');
      return;
    }
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>Saving…`;
    try {
      await saveBean(bean);
      if (chosen) await setBeanImage(bean.id, chosen, rawBlob);
      toast('Saved');
      // replace, not push: Back should skip the editor entirely
      goReplace(`#/bean/${bean.id}`);
    } catch (err) {
      toast(err.message || 'Save failed');
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  };

  root.appendChild(view);

  /* Editing: show the saved image, and restore the original camera photo so
     the background can be changed or the render redone without re-shooting. */
  if (!isNew) {
    const savedURL = await beanImageURL(bean);
    if (savedURL) {
      showPreview(savedURL);
      tools.hidden = false;
      variants.saved = { blob: null, url: savedURL };
      selected = 'saved';
      paintVariants();
    }
    const storedRaw = await beanRawBlob(bean.id);
    if (storedRaw) {
      try {
        rawBlob = storedRaw;
        rawImg = await fileToImage(storedRaw);
        // build the "Photo" option so the saved render isn't the only choice
        await buildVariants();
        status.textContent = 'Tap the frame to replace the photo.';
      } catch { /* corrupt blob — fall through */ }
    } else if (savedURL) {
      status.textContent = 'Only the finished image is saved for this bag — retake the photo to re-render it.';
    }
  }

  return {
    destroy() {
      // 'saved' borrows the store's cached object URL — revoking it would
      // break the image everywhere else in the app.
      Object.entries(variants).forEach(([k, v]) => {
        if (k !== 'saved' && v?.url) URL.revokeObjectURL(v.url);
      });
    },
  };
}
