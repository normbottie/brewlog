/* Log a brew: a photo of the cup, how it was made, and what you thought of
   it. Deliberately short — this is something you fill in while the coffee
   is still hot, not a second tasting form.

   The tasting profile lives here, not on the bag: the bag's own "compass"
   is just the average of every brew's profile, recomputed each time one is
   logged. It opens by itself on a bag's first brew, since that is the one
   time there is nothing yet to average — every brew after that starts
   collapsed. */

import {
  blankBrew, saveBrew, setBrewImage, brewImageURL, removeBrew, listBrews,
  AXES, AXIS_LABELS,
} from '../store.js';
import { h, esc, icon, sheet, toast, confirmSheet, bindRange } from '../ui.js';
import { radarSVG } from '../radar.js';
import { brewVariants } from '../imaging.js';

/* The most recent brew's method first, then the handful people actually
   reach for. */
const QUICK_METHODS = ['Espresso', 'Latte', 'Flat White', 'Pour Over', 'AeroPress', 'Drip'];

function methodChoices(lastMethod) {
  const out = [];
  if (lastMethod) out.push(lastMethod);
  for (const m of QUICK_METHODS) if (m !== lastMethod) out.push(m);
  return out.slice(0, 6);
}

const fmtR = (v) => Number(v ?? 0).toFixed(1);

/* The rotation goes on an inner <g>, not on the <svg> itself: a transform on
   the root element moves the whole box in its parent's coordinates, which
   just carried the thumbs-down out of view. */
export function thumbIcon(dirn, size = 11, color = '#E4C79A') {
  const rot = dirn === 'down' ? ' transform="rotate(180 12 12)"'
    : dirn === 'neutral' ? ' transform="rotate(90 12 12)"' : '';
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
export async function brewSheet(bean, existing, onDone) {
  const siblings = await listBrews(bean.id);
  const priorBrews = siblings.filter(b => !existing || b.id !== existing.id);
  // nothing to average yet on a bag's very first brew — open the tile for
  // it, and let every brew after that start out of the way
  const firstBrew = priorBrews.length === 0;

  const brew = existing
    ? { ...existing, ratings: { ...existing.ratings } }
    : blankBrew(bean.id, priorBrews[0]?.method || '');
  const isNew = !existing;
  let pending = null;      // { thumb, full } not yet stored
  let previewURL = null;

  return sheet(isNew ? 'Log a brew' : 'Edit brew', (close) => {
    const methods = methodChoices(priorBrews[0]?.method || '');
    if (brew.method && !methods.includes(brew.method)) methods.unshift(brew.method);

    const node = h(`<div>
      <div style="font-size:13.5px;color:var(--tan);font-weight:550;margin:-8px 0 16px">
        ${esc(bean.name || 'Untitled')}${bean.roaster ? ` · ${esc(bean.roaster)}` : ''}
      </div>

      <button type="button" class="brew-drop" data-pick>
        <img data-preview hidden alt="">
        <div data-empty>
          ${icon('camera')}
          <div style="font-weight:600;font-size:15px;margin-top:8px">Take a photo of the cup (optional)</div>
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
          <label for="b-grind">Grind</label>
          <input id="b-grind" data-grind placeholder="18g in, 38g out, 27s"
                 value="${esc(brew.grind || '')}">
        </div>
      </div>

      <div class="field">
        <label for="b-recipe">Recipe</label>
        <input id="b-recipe" data-recipe placeholder="18 g → 38 g, 27 s"
               value="${esc(brew.recipe || '')}">
      </div>

      <details class="fold" ${firstBrew ? 'open' : ''} data-fold="tasting">
        <summary><span>Tasting profile</span></summary>
        <div class="glass radar-wrap" data-radar style="margin-top:12px">${radarSVG(brew.ratings)}</div>
        <div class="glass card-pad" style="margin-top:12px">
          ${AXES.map(a => `<div class="slider-row">
            <div class="lbl">${AXIS_LABELS[a]}</div>
            <input type="range" min="0" max="5" step="0.1" value="${brew.ratings[a]}" data-axis="${a}"
                   aria-label="${AXIS_LABELS[a]}">
            <div class="val" data-axisval="${a}">${fmtR(brew.ratings[a])}</div>
          </div>`).join('')}
        </div>
      </details>

      <div class="field" style="margin-top:16px">
        <label>How did this one go?</label>
        <div class="verdict" data-verdict>
          <button type="button" data-v="up" aria-pressed="${brew.verdict === 'up'}">
            ${thumbIcon('up', 21, 'currentColor')} Good one
          </button>
          <button type="button" data-v="neutral" aria-pressed="${brew.verdict === 'neutral'}">
            ${thumbIcon('neutral', 21, 'currentColor')} Fine
          </button>
          <button type="button" data-v="down" aria-pressed="${brew.verdict === 'down'}">
            ${thumbIcon('down', 21, 'currentColor')} Not great
          </button>
        </div>
        <div class="hint">Optional. The bag's average updates to match whenever you log one.</div>
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

    const radarBox = node.querySelector('[data-radar]');
    node.querySelectorAll('[data-axis]').forEach(inp => {
      bindRange(inp);
      inp.addEventListener('input', () => {
        const a = inp.dataset.axis;
        brew.ratings[a] = Math.round(Number(inp.value) * 10) / 10;
        node.querySelector(`[data-axisval="${a}"]`).textContent = fmtR(brew.ratings[a]);
        radarBox.innerHTML = radarSVG(brew.ratings);
      });
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
      brew.grind = node.querySelector('[data-grind]').value.trim();
      brew.recipe = node.querySelector('[data-recipe]').value.trim();
      brew.notes = node.querySelector('[data-notes]').value;

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
