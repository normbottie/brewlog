/* Single bean — hero shot, radar, details, notes. */

import { getBean, beanImageURL, removeBean, AXES, AXIS_LABELS } from '../store.js';
import { h, esc, icon, stars, fmtDate, confirmSheet, toast } from '../ui.js';
import { radarSVG } from '../radar.js';

export async function render(root, id) {
  const b = await getBean(id);
  if (!b || b.deleted) {
    root.innerHTML = `<div class="view"><div class="empty glass card-pad">
      <h3>Bean not found</h3><p>It may have been deleted.</p></div></div>`;
    return;
  }

  const kv = [
    ['Origin', [b.origin, b.region].filter(Boolean).join(' · ')],
    ['Process', b.process],
    ['Varietal', b.varietal],
    ['Roast', b.roast_level],
    ['Roasted', b.roast_date ? fmtDate(b.roast_date) : ''],
    ['Brewed as', b.brew_method],
    ['Grind', b.grind],
    ['Price', b.price ? (b.weight_g ? `${b.price} · ${b.weight_g}g` : String(b.price)) : ''],
  ].filter(([, v]) => v);

  const view = h(`<div>
    <div class="topbar">
      <button class="icon-btn" data-back aria-label="Back">${icon('back')}</button>
      <div class="spacer"></div>
      <button class="icon-btn" data-edit aria-label="Edit">${icon('edit')}</button>
      <button class="icon-btn btn-danger" data-del aria-label="Delete">${icon('trash')}</button>
    </div>
    <div class="view">
      <div class="hero glass">
        <img data-hero alt="${esc(b.name || 'Coffee bag')}"
             src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
        <div class="fade"></div>
        <div class="cap">
          <h2>${esc(b.name || 'Untitled')}</h2>
          ${b.roaster ? `<div class="roaster">${esc(b.roaster)}</div>` : ''}
          ${b.overall ? `<div style="margin-top:8px">${stars(b.overall)}</div>` : ''}
        </div>
      </div>

      ${(b.flavor_notes || []).length ? `
        <div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:16px">
          ${b.flavor_notes.map(n => `<span class="chip">${esc(n)}</span>`).join('')}
        </div>` : ''}

      <h2 class="section">Tasting profile</h2>
      <div class="glass radar-wrap">${radarSVG(b.ratings)}</div>
      <div class="glass card-pad" style="margin-top:12px">
        ${AXES.map(a => `<div class="slider-row">
          <div class="lbl">${AXIS_LABELS[a]}</div>
          <div style="flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,.09);overflow:hidden">
            <div style="height:100%;width:${((Number(b.ratings?.[a]) || 0) / 5) * 100}%;
                 background:linear-gradient(90deg,rgba(201,168,124,.5),var(--tan-bright));border-radius:3px"></div>
          </div>
          <div class="val">${(Number(b.ratings?.[a]) || 0).toFixed(1)}</div>
        </div>`).join('')}
      </div>

      ${kv.length ? `<h2 class="section">Details</h2>
        <div class="kv">${kv.map(([k, v]) =>
          `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>` : ''}

      ${b.notes ? `<h2 class="section">Notes</h2>
        <div class="glass card-pad"><div class="notes-body">${esc(b.notes)}</div></div>` : ''}

      <div style="height:14px"></div>
      <div class="hint" style="text-align:center">Logged ${fmtDate(b.created_at)}</div>
    </div>
  </div>`);

  view.querySelector('[data-back]').onclick = () => history.length > 1 ? history.back() : (location.hash = '#/beans');
  view.querySelector('[data-edit]').onclick = () => { location.hash = `#/bean/${b.id}/edit`; };
  view.querySelector('[data-del]').onclick = async () => {
    if (await confirmSheet('Delete this bean?', `“${b.name || 'Untitled'}” and its photo will be removed.`)) {
      await removeBean(b.id);
      toast('Deleted');
      location.hash = '#/beans';
    }
  };

  root.appendChild(view);

  const url = await beanImageURL(b);
  if (url) view.querySelector('[data-hero]').src = url;
  else view.querySelector('.hero img').style.minHeight = '200px';
}
