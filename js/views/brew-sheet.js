/* Log a brew: a photo of the cup, how it was made, and whether it was any
   good. Deliberately short — this is something you fill in while the coffee
   is still hot, not a second tasting form. */

import {
  blankBrew, saveBrew, setBrewImage, brewImageURL, removeBrew,
} from '../store.js';
import { h, esc, icon, sheet, toast, confirmSheet } from '../ui.js';
import { brewVariants } from '../imaging.js';

/* The bag's own method first, then the handful people actually reach for.
   The full list is on the bag; a brew only needs the common cases. */
const QUICK_METHODS = ['Espresso', 'Latte', 'Flat White', 'Pour Over', 'AeroPress', 'Drip'];

function methodChoices(beanMethod) {
  const out = [];
  if (beanMethod) out.push(beanMethod);
  for (const m of QUICK_METHODS) if (m !== beanMethod) out.push(m);
  return out.slice(0, 6);
}

/* The rotation goes on an inner <g>, not on the <svg> itself: a transform on
   the root element moves the whole box in its parent's coordinates, which
   just carried the thumbs-down out of view. */
export function thumbIcon(dirn, size = 11, color = '#E4C79A') {
  const rot = dirn === 'down' ? ' transform="rotate(180 12 12)"' : '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <g${rot}>
      <path d="M6.8 10.6h-2A1.8 1.8 0 0 0 3 12.4v6a1.8 1.8 0 0 0 1.8 1.8h2Z"/>
      <path d="M6.8 10.6 11 3.4a1.8 1.8 0 0 1 3.3 1v4h4.3a2.2 2.2 0 0 1 2.15 2.65l-1.25 5.9
               a2.2 2.2 0 0 1-2.15 1.75H6.8Z"/>
    </g></svg>`;
}

/**
 * @param {object} bean   the bag this brew belongs to
 * @param {object|null} existing  a brew to edit, or null for a new one
 * @param {Function} onDone
 */
export function brewSheet(bean, existing, onDone) {
  const brew = existing
    ? { ...existing }
    : blankBrew(bean.id, bean.brew_method || 'Espresso');
  const isNew = !existing;
  let pending = null;      // { thumb, full } not yet stored
  let previewURL = null;

  return sheet(isNew ? 'Log a brew' : 'Edit brew', (close) => {
    const methods = methodChoices(bean.brew_method);
    if (brew.method && !methods.includes(brew.method)) methods.unshift(brew.method);

    const node = h(`<div>
      <div style="font-size:13.5px;color:var(--tan);font-weight:550;margin:-8px 0 16px">
        ${esc(bean.name || 'Untitled')}${bean.roaster ? ` · ${esc(bean.roaster)}` : ''}
      </div>

      <button type="button" class="brew-drop" data-pick>
        <img data-preview hidden alt="">
        <div data-empty>
          ${icon('camera')}
          <div style="font-weight:600;font-size:15px;margin-top:8px">Take a photo of the cup</div>
          <div class="hint" style="margin-top:4px">Or choose one from your library.</div>
        </div>
      </button>
      <input type="file" accept="image/*" hidden data-file>
      <div class="hint" data-imgstatus style="margin-bottom:16px"></div>

      <div class="field">
        <label>Brewed as</label>
        <div class="seg" data-methods>
          ${methods.map(m => `<button type="button" data-m="${esc(m)}"
            aria-pressed="${m === brew.method}">${esc(m)}</button>`).join('')}
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="b-date">Date</label>
          <input id="b-date" type="date" data-date value="${esc(brew.brewed_on || '')}">
        </div>
        <div class="field">
          <label for="b-recipe">Recipe</label>
          <input id="b-recipe" data-recipe placeholder="18 g → 38 g, 27 s"
                 value="${esc(brew.recipe || '')}">
        </div>
      </div>

      <div class="field">
        <label>How did this one go?</label>
        <div class="verdict" data-verdict>
          <button type="button" data-v="up" aria-pressed="${brew.verdict === 'up'}">
            ${thumbIcon('up', 21, 'currentColor')} Good one
          </button>
          <button type="button" data-v="down" aria-pressed="${brew.verdict === 'down'}">
            ${thumbIcon('down', 21, 'currentColor')} Not great
          </button>
        </div>
        <div class="hint">Optional, and it stays on this cup — the bag keeps its own tasting profile.</div>
      </div>

      <div class="field">
        <label for="b-notes">Note</label>
        <textarea id="b-notes" data-notes
          placeholder="How it pulled, what you changed…">${esc(brew.notes || '')}</textarea>
      </div>

      <button class="btn-primary btn-block" data-save>${isNew ? 'Save brew' : 'Save changes'}</button>
      <div class="hint" data-status style="margin-top:10px"></div>
      ${isNew ? '' : `<button class="btn-danger btn-block btn-sm" data-del
        style="margin-top:12px">Delete this brew</button>`}
    </div>`);

    const fileEl = node.querySelector('[data-file]');
    const previewEl = node.querySelector('[data-preview]');
    const emptyEl = node.querySelector('[data-empty]');
    const imgStatus = node.querySelector('[data-imgstatus]');
    const status = node.querySelector('[data-status]');

    function showPreview(url) {
      previewEl.src = url;
      previewEl.hidden = false;
      emptyEl.hidden = true;
    }

    // an existing brew opens on its own photo
    if (!isNew) {
      brewImageURL(brew, 'thumb').then(url => { if (url) showPreview(url); });
    }

    node.querySelector('[data-pick]').onclick = () => fileEl.click();
    fileEl.onchange = async () => {
      const file = fileEl.files?.[0];
      if (!file) return;
      imgStatus.innerHTML = '<span class="busy"><span class="spinner"></span>Preparing…</span>';
      try {
        pending = await brewVariants(file);
        if (previewURL) URL.revokeObjectURL(previewURL);
        previewURL = URL.createObjectURL(pending.thumb);
        showPreview(previewURL);
        imgStatus.textContent = '';
      } catch (err) {
        imgStatus.textContent = err.message || 'Could not read that photo';
      }
    };

    node.querySelector('[data-methods]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      brew.method = b.dataset.m;
      node.querySelectorAll('[data-m]').forEach(x =>
        x.setAttribute('aria-pressed', String(x.dataset.m === brew.method)));
    });

    node.querySelector('[data-verdict]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      // tapping the set one again clears it — no verdict is a real answer
      brew.verdict = brew.verdict === b.dataset.v ? null : b.dataset.v;
      node.querySelectorAll('[data-v]').forEach(x =>
        x.setAttribute('aria-pressed', String(x.dataset.v === brew.verdict)));
    });

    node.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!await confirmSheet('Delete this brew?', 'The photo and note will be removed.')) return;
      await removeBrew(brew.id);
      close();
      toast('Brew deleted');
      onDone && onDone();
    });

    node.querySelector('[data-save]').onclick = async (e) => {
      const btn = e.currentTarget;
      brew.brewed_on = node.querySelector('[data-date]').value;
      brew.recipe = node.querySelector('[data-recipe]').value.trim();
      brew.notes = node.querySelector('[data-notes]').value;

      if (isNew && !pending) {
        status.textContent = 'Add a photo of the cup first.';
        return;
      }
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Saving…';
      try {
        await saveBrew(brew);
        // the image write needs the row to exist, so it follows the save
        if (pending) await setBrewImage(brew.id, pending.thumb, pending.full);
        close();
        toast(isNew ? 'Brew logged' : 'Brew saved');
        onDone && onDone();
      } catch (err) {
        status.textContent = err.message || 'Could not save that';
        btn.disabled = false;
        btn.textContent = isNew ? 'Save brew' : 'Save changes';
      }
    };

    return node;
  });
}
