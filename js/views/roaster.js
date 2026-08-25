/* One roaster — everything you've logged from them, and what it averages to.

   A roaster has no record of its own: it's the name typed on a bag, folded to
   a key. So this page is derived on the fly, and it exists for exactly as long
   as you own a bag from them. */

import { getRoaster, beanImageURL, AXES, AXIS_LABELS, isForeign, membersById } from '../store.js';
import { h, esc, icon, stars, empty, ownerBadge } from '../ui.js';
import { radarSVG } from '../radar.js';

const one = (n) => Number(n || 0).toFixed(1);

export async function render(root, key) {
  const rk = decodeURIComponent(key || '');
  /* Shared scope on purpose: if a friend shares their log, "who else has had
     this roaster" is the interesting question. Ownership stays visible. */
  const r = await getRoaster(rk, { shared: true });

  if (!r) {
    root.innerHTML = `<div class="view">${empty('bean', 'Nothing from this roaster',
      'The bags that pointed here have been deleted or renamed.')}</div>`;
    return;
  }

  const members = membersById();
  const facts = [
    ['Origins', r.origins.join(' · ')],
    ['Processes', r.processes.join(' · ')],
    ['Brewed as', r.methods.join(' · ')],
  ].filter(([, v]) => v);

  const view = h(`<div>
    <div class="topbar">
      <button class="icon-btn" data-back aria-label="Back">${icon('back')}</button>
      <div>
        <h1>${esc(r.name || 'Roaster')}</h1>
        <div class="sub">${r.count} bag${r.count === 1 ? '' : 's'} logged</div>
      </div>
    </div>
    <div class="view">

      <div class="glass card-pad stat-row">
        <div class="stat">
          <div class="big">${r.rated ? one(r.avgOverall) : '—'}</div>
          <div class="lbl">Average</div>
          ${r.rated ? `<div style="margin-top:5px">${stars(Math.round(r.avgOverall))}</div>` : ''}
        </div>
        <div class="stat">
          <div class="big">${r.count}</div>
          <div class="lbl">Bag${r.count === 1 ? '' : 's'}</div>
        </div>
      </div>
      ${r.rated && r.rated < r.count
        ? `<div class="hint" style="margin-top:8px;text-align:center">
             Averaged over the ${r.rated} bag${r.rated === 1 ? '' : 's'} you gave an overall rating.
           </div>` : ''}

      <h2 class="section">Their profile, on average</h2>
      <div class="glass radar-wrap">${radarSVG(r.ratings)}</div>
      <div class="glass card-pad" style="margin-top:12px">
        ${AXES.map(a => `<div class="slider-row">
          <div class="lbl">${AXIS_LABELS[a]}</div>
          <div style="flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,.09);overflow:hidden">
            <div style="height:100%;width:${(r.ratings[a] / 5) * 100}%;
                 background:linear-gradient(90deg,rgba(201,168,124,.5),var(--tan-bright));border-radius:3px"></div>
          </div>
          <div class="val">${one(r.ratings[a])}</div>
        </div>`).join('')}
      </div>

      ${facts.length ? `<h2 class="section">What you've had</h2>
        <div class="kv">${facts.map(([k, v]) =>
          `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>` : ''}

      <h2 class="section">The bags</h2>
      <div>${r.beans.map(b => {
        const foreign = isForeign(b);
        const owner = foreign ? members.get(b.user_id) : null;
        return `<a class="glass cafe-row" href="#/bean/${esc(b.id)}">
          <div class="avatar shot">
            ${esc((b.name || b.roaster || '?').trim().charAt(0).toUpperCase())}
            <img data-beanimg="${esc(b.id)}" alt="" hidden>
          </div>
          <div class="body">
            <div class="nm">${esc(b.name || 'Untitled')}</div>
            <div class="addr">${esc([b.origin, b.process].filter(Boolean).join(' · ') || '—')}</div>
            <div style="margin-top:5px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              ${b.overall ? stars(b.overall) : ''}${foreign ? ownerBadge(owner) : ''}
            </div>
          </div>
          <span class="chev">${icon('back')}</span>
        </a>`;
      }).join('')}</div>

      <div style="height:10px"></div>
    </div>
  </div>`);

  view.querySelector('[data-back]').onclick = () =>
    history.length > 1 ? history.back() : (location.hash = '#/beans');

  root.appendChild(view);

  r.beans.forEach(async b => {
    const url = await beanImageURL(b);
    const img = view.querySelector(`[data-beanimg="${b.id}"]`);
    if (url && img) { img.src = url; img.hidden = false; }
  });
}
