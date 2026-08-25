/* Single bean — hero shot, radar, details, notes. */

import {
  getBean, beanImageURL, removeBean, AXES, AXIS_LABELS, isForeign, membersById,
  importBean, myBeanLike, cafeForBean, roasterKey,
} from '../store.js';
import { h, esc, icon, stars, fmtDate, confirmSheet, toast, ownerBadge, goReplace, sheet } from '../ui.js';
import { radarSVG } from '../radar.js';
import { shareBeanCard } from '../card.js';

export async function render(root, id) {
  const b = await getBean(id);
  if (!b || b.deleted) {
    root.innerHTML = `<div class="view"><div class="empty glass card-pad">
      <h3>Bean not found</h3><p>It may have been deleted.</p></div></div>`;
    return;
  }

  const foreign = isForeign(b);
  const owner = foreign ? membersById().get(b.user_id) : null;
  const cafe = await cafeForBean(b);
  const rKey = roasterKey(b.roaster);

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
      ${foreign ? '' : `<button class="icon-btn" data-edit aria-label="Edit">${icon('edit')}</button>
      <button class="icon-btn btn-danger" data-del aria-label="Delete">${icon('trash')}</button>`}
    </div>
    <div class="view">
      <div class="hero glass">
        <img data-hero alt="${esc(b.name || 'Coffee bag')}"
             src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
        <div class="fade"></div>
        <div class="cap">
          <h2>${esc(b.name || 'Untitled')}</h2>
          ${b.roaster ? (rKey
            ? `<a class="roaster link" href="#/roaster/${encodeURIComponent(rKey)}">${esc(b.roaster)}</a>`
            : `<div class="roaster">${esc(b.roaster)}</div>`) : ''}
          ${b.overall ? `<div style="margin-top:8px">${stars(b.overall)}</div>` : ''}
        </div>
      </div>

      ${foreign ? `<div class="read-only-note" style="margin-bottom:10px">
          ${ownerBadge(owner)} <span>Shared entry — read only</span></div>
        <button class="btn-primary btn-block" data-import style="margin-bottom:16px">
          ${icon('plus')} Log my own
        </button>
        <div class="hint" data-importstatus style="margin:-8px 0 16px"></div>` : ''}

      ${(b.flavor_notes || []).length ? `
        <div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:16px">
          ${b.flavor_notes.map(n => `<span class="chip">${esc(n)}</span>`).join('')}
        </div>` : ''}

      ${cafe ? `<a class="glass cafe-row" href="#/cafe/${esc(cafe.id)}" style="margin-bottom:16px">
          <div class="avatar">${esc((cafe.name || '?').trim().charAt(0).toUpperCase())}</div>
          <div class="body">
            <div class="hint" style="margin:0 0 1px">Got it at</div>
            <div class="nm">${esc(cafe.name || 'Untitled')}</div>
            <div class="addr">${esc(cafe.address || 'No address')}</div>
          </div>
          <span class="chev">${icon('back')}</span>
        </a>` : ''}

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

      <div style="height:20px"></div>
      <button class="btn-block" data-card>${icon('card')} Make a share card</button>

      <div style="height:14px"></div>
      <div class="hint" style="text-align:center">Logged ${fmtDate(b.created_at)}</div>
    </div>
  </div>`);

  view.querySelector('[data-back]').onclick = () => history.length > 1 ? history.back() : (location.hash = '#/beans');
  view.querySelector('[data-edit]')?.addEventListener('click', () => { location.hash = `#/bean/${b.id}/edit`; });
  view.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (await confirmSheet('Delete this bean?', `“${b.name || 'Untitled'}” and its photo will be removed.`)) {
      await removeBean(b.id);
      toast('Deleted');
      goReplace('#/beans');   // don't leave a deleted bean in the back stack
    }
  });

  /* Copy a shared bag into your own log and go straight to the editor, so
     the next thing you do is record how it tasted to you. */
  const importStatus = view.querySelector('[data-importstatus]');
  const importBtn = view.querySelector('[data-import]');

  async function doImport() {
    importBtn.disabled = true;
    importBtn.innerHTML = '<span class="spinner"></span> Adding…';
    importStatus.textContent = '';
    try {
      const mine = await importBean(b.id);
      toast('Added to your beans');
      // replace: Back should return to the list, not to their copy
      goReplace(`#/bean/${mine.id}/edit`);
    } catch (err) {
      importStatus.textContent = err.message || 'Could not add that';
      importBtn.disabled = false;
      importBtn.innerHTML = `${icon('plus')} Log my own`;
    }
  }

  importBtn?.addEventListener('click', async () => {
    const existing = await myBeanLike(b);
    if (!existing) return doImport();
    /* Silently making a second copy is the wrong default — you almost
       always meant the one you already have. */
    sheet('You already logged this', (close) => {
      const node = h(`<div>
        <p style="color:var(--text-muted);margin:0 0 20px;line-height:1.55">
          “${esc(existing.name || 'Untitled')}” is already in your beans.
        </p>
        <div class="stack">
          <button class="btn-primary btn-block" data-open>Open mine</button>
          <button class="btn-block" data-again>Add a second entry</button>
        </div></div>`);
      node.querySelector('[data-open]').onclick = () => {
        close();
        goReplace(`#/bean/${existing.id}`);
      };
      node.querySelector('[data-again]').onclick = () => { close(); doImport(); };
      return node;
    });
  });

  const cardBtn = view.querySelector('[data-card]');
  cardBtn.addEventListener('click', async () => {
    const label = cardBtn.innerHTML;
    cardBtn.disabled = true;
    cardBtn.innerHTML = '<span class="spinner"></span> Drawing…';
    try {
      await shareBeanCard(b, { cafe });
    } catch (err) {
      toast(err.message || 'Could not make the card');
    } finally {
      cardBtn.disabled = false;
      cardBtn.innerHTML = label;
    }
  });

  root.appendChild(view);

  const url = await beanImageURL(b);
  if (url) view.querySelector('[data-hero]').src = url;
  else view.querySelector('.hero img').style.minHeight = '200px';
}
