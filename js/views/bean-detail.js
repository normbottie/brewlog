/* Single bean — bag shot, radar, details, notes.

   The header is deliberately a portrait beside the facts rather than a
   full-bleed hero: at 4:5 a hero pushed everything worth reading below the
   fold. Tapping the portrait still opens it full width. */

import {
  getBean, beanImageURL, removeBean, AXES, AXIS_LABELS, isForeign, membersById,
  importBean, myBeanLike, beanNeighbours, canEdit,
} from '../store.js';
import { h, esc, icon, stars, fmtDate, confirmSheet, toast, ownerBadge, goReplace, sheet } from '../ui.js';
import { radarSVG } from '../radar.js';

/* Five columns across a phone leaves no room for "Aromatics"; the radar
   beside them already carries the full names. */
const AXIS_SHORT = {
  aromatics: 'Aroma', acidity: 'Acid', sweetness: 'Sweet',
  aftertaste: 'Finish', body: 'Body',
};

export async function render(root, id) {
  const b = await getBean(id);
  if (!b || b.deleted) {
    root.innerHTML = `<div class="view"><div class="empty glass card-pad">
      <h3>Bean not found</h3><p>It may have been deleted.</p></div></div>`;
    return;
  }

  const foreign = isForeign(b);
  const owner = foreign ? membersById().get(b.user_id) : null;
  /* Admins may correct anyone's entry; everyone else sees a shared one
     read-only. `locked` is about the controls, `foreign` about ownership —
     an admin editing someone else's bag is still not the owner of it. */
  const locked = foreign && !canEdit(b);

  /* The two facts most likely to be wanted at a glance sit beside the
     photo; the rest go in the grid below rather than repeating. */
  const headFacts = [
    ['Origin', [b.origin, b.region].filter(Boolean).join(' · ')],
    ['Brewed as', b.brew_method],
  ].filter(([, v]) => v);

  const kv = [
    ['Process', b.process],
    ['Varietal', b.varietal],
    ['Roast', b.roast_level],
    ['Roasted', b.roast_date ? fmtDate(b.roast_date) : ''],
    ['Grind', b.grind],
    ['Price', b.price ? (b.weight_g ? `${b.price} · ${b.weight_g}g` : String(b.price)) : ''],
  ].filter(([, v]) => v);

  const { prev, next, index, total } = await beanNeighbours(id);

  const view = h(`<div>
    <div class="topbar">
      <button class="icon-btn" data-back aria-label="Back">${icon('back')}</button>
      <div class="spacer"></div>
      ${locked ? '' : `<button class="icon-btn" data-edit aria-label="Edit">${icon('edit')}</button>
      <button class="icon-btn btn-danger" data-del aria-label="Delete">${icon('trash')}</button>`}
    </div>
    <div class="view">
      <div class="head-wrap">
        ${total > 1 ? `<button class="pager-btn prev" data-prev
            aria-label="Previous bag">${icon('back')}</button>
          <button class="pager-btn next" data-next
            aria-label="Next bag">${icon('back')}</button>` : ''}
        <div class="bean-head glass">
          <button class="portrait" data-expand aria-label="Show the full photo">
            <img data-hero alt="${esc(b.name || 'Coffee bag')}"
                 src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
          </button>
          <div class="head-meta">
            <h2>${esc(b.name || 'Untitled')}</h2>
            ${b.roaster ? `<div class="roaster">${esc(b.roaster)}</div>` : ''}
            ${b.overall ? `<div style="margin-top:7px">${stars(b.overall)}</div>` : ''}
            ${headFacts.length ? `<dl class="head-facts">${headFacts.map(([k, v]) =>
              `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
          </div>
        </div>
      </div>
      ${total > 1 ? `<div class="pager-pos">${index + 1} of ${total}</div>` : ''}

      ${foreign ? `<div class="read-only-note" style="margin-bottom:10px">
          ${ownerBadge(owner)} <span>${locked ? 'Shared entry — read only'
            : 'Shared entry — you are editing it as an admin'}</span></div>
        <button class="btn-primary btn-block" data-import style="margin-bottom:16px">
          ${icon('plus')} Log my own
        </button>
        <div class="hint" data-importstatus style="margin:-8px 0 16px"></div>` : ''}

      ${(b.flavor_notes || []).length ? `
        <div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:16px">
          ${b.flavor_notes.map(n => `<span class="chip">${esc(n)}</span>`).join('')}
        </div>` : ''}

      <h2 class="section">Tasting profile</h2>
      <div class="glass tasting">
        <div class="radar-wrap">${radarSVG(b.ratings)}</div>
        <div class="axis-strip">
          ${AXES.map(a => `<div class="axis-stat">
            <div class="n">${(Number(b.ratings?.[a]) || 0).toFixed(1)}</div>
            <div class="k" title="${esc(AXIS_LABELS[a])}">${esc(AXIS_SHORT[a] || AXIS_LABELS[a])}</div>
          </div>`).join('')}
        </div>
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

  /* Paging. goReplace, not a push: walking twenty bags should not bury the
     list under twenty back-presses. */
  const goTo = (bean) => { if (bean) goReplace(`#/bean/${bean.id}`); };
  view.querySelector('[data-prev]')?.addEventListener('click', () => goTo(prev));
  view.querySelector('[data-next]')?.addEventListener('click', () => goTo(next));

  const onKey = (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowLeft') goTo(prev);
    else if (e.key === 'ArrowRight') goTo(next);
  };
  document.addEventListener('keydown', onKey);

  view.querySelector('[data-expand]')?.addEventListener('click', (e) => {
    e.currentTarget.closest('.bean-head').classList.toggle('expanded');
  });

  root.appendChild(view);

  const url = await beanImageURL(b);
  if (url) view.querySelector('[data-hero]').src = url;
  else view.querySelector('.portrait').classList.add('no-photo');

  return { destroy() { document.removeEventListener('keydown', onKey); } };
}
