/* One brew, full size. The photo is fetched here rather than at sync time —
   this screen is the only place the full-resolution image is ever needed. */

import {
  getBrew, getBean, listBrews, brewImageURL, isForeign, membersById, canEdit,
  BREW_VERDICTS,
} from '../store.js';
import { h, esc, icon, fmtDate, ownerBadge, goReplace } from '../ui.js';
import { brewSheet, thumbIcon } from './brew-sheet.js';

export async function render(root, id) {
  const brew = await getBrew(id);
  if (!brew || brew.deleted) {
    root.innerHTML = `<div class="view"><div class="empty glass card-pad">
      <h3>Brew not found</h3><p>It may have been deleted.</p></div></div>`;
    return;
  }

  const bean = await getBean(brew.bean_id);
  const foreign = isForeign(brew);
  const owner = foreign ? membersById().get(brew.user_id) : null;
  const locked = foreign && !canEdit(brew);

  const siblings = await listBrews(brew.bean_id);
  const i = siblings.findIndex(b => b.id === brew.id);
  const total = siblings.length;
  const prev = total > 1 ? siblings[(i - 1 + total) % total] : null;
  const next = total > 1 ? siblings[(i + 1) % total] : null;

  const kv = [
    ['Method', brew.method],
    ['Date', brew.brewed_on ? fmtDate(brew.brewed_on) : ''],
    ['Recipe', brew.recipe],
  ].filter(([, v]) => v);

  const view = h(`<div>
    <div class="topbar">
      <button class="icon-btn" data-back aria-label="Back">${icon('back')}</button>
      <div class="spacer"></div>
      ${locked ? '' : `<button class="icon-btn" data-edit aria-label="Edit">${icon('edit')}</button>`}
    </div>
    <div class="view">

      <div class="head-wrap" style="margin-bottom:14px">
        ${total > 1 ? `<button class="pager-btn prev" data-prev aria-label="Previous brew">${icon('back')}</button>
          <button class="pager-btn next" data-next aria-label="Next brew">${icon('back')}</button>` : ''}
        <div class="glass brew-hero">
          <img data-photo alt="${esc(bean?.name ? `Brew of ${bean.name}` : 'Brew')}"
               src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
          <div class="brew-loading" data-loading><span class="spinner"></span></div>
        </div>
      </div>
      ${total > 1 ? `<div class="pager-pos">${i + 1} of ${total}</div>` : ''}

      <div class="glass card-pad" style="margin-bottom:4px">
        <div style="display:flex;align-items:flex-start;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="font-size:18px;font-weight:620;letter-spacing:-.015em">
              ${esc(brew.brewed_on ? fmtDate(brew.brewed_on) : 'A brew')}
            </div>
            ${bean ? `<button class="linky" data-bean>${esc(bean.name || 'Untitled')}${
              bean.roaster ? ` · ${esc(bean.roaster)}` : ''}</button>` : ''}
          </div>
          ${brew.verdict ? `<div class="verdict-chip ${esc(brew.verdict)}">
            ${thumbIcon(brew.verdict, 15, 'currentColor')}
            ${esc(BREW_VERDICTS[brew.verdict] || '')}
          </div>` : ''}
        </div>
        ${foreign ? `<div class="read-only-note" style="margin-top:13px">
          ${ownerBadge(owner)} <span>${locked ? 'Shared entry — read only'
            : 'Shared entry — you are editing it as an admin'}</span></div>` : ''}
      </div>

      ${kv.length ? `<h2 class="section">The pull</h2>
        <div class="kv">${kv.map(([k, v]) =>
          `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>` : ''}

      ${brew.notes ? `<h2 class="section">Note</h2>
        <div class="glass card-pad"><div class="notes-body">${esc(brew.notes)}</div></div>` : ''}

      <div style="height:14px"></div>
      <div class="hint" style="text-align:center">
        ${total === 1 ? 'The only brew from this bag' : `Brew ${i + 1} of ${total} from this bag`}
      </div>
    </div>
  </div>`);

  view.querySelector('[data-back]').onclick = () =>
    history.length > 1 ? history.back() : (location.hash = `#/bean/${brew.bean_id}`);
  view.querySelector('[data-bean]')?.addEventListener('click',
    () => { location.hash = `#/bean/${brew.bean_id}`; });

  const goTo = (b) => { if (b) goReplace(`#/brew/${b.id}`); };
  view.querySelector('[data-prev]')?.addEventListener('click', () => goTo(prev));
  view.querySelector('[data-next]')?.addEventListener('click', () => goTo(next));

  const onKey = (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowLeft') goTo(prev);
    else if (e.key === 'ArrowRight') goTo(next);
  };
  document.addEventListener('keydown', onKey);

  view.querySelector('[data-edit]')?.addEventListener('click', () => {
    if (!bean) return;
    brewSheet(bean, brew, () => {
      document.dispatchEvent(new CustomEvent('brewlog:data'));
    });
  });

  root.appendChild(view);

  /* The one place the full photo is pulled. The thumbnail is already on the
     device, so it stands in until the big one lands — and stays if it
     never does. */
  const photo = view.querySelector('[data-photo]');
  const loading = view.querySelector('[data-loading]');
  const thumb = await brewImageURL(brew, 'thumb');
  if (thumb) photo.src = thumb;

  brewImageURL(brew, 'full').then(url => {
    if (url && url !== thumb) photo.src = url;
    loading.hidden = true;
  }).catch(() => { loading.hidden = true; });
  if (!brew.image_url) loading.hidden = true;

  return { destroy() { document.removeEventListener('keydown', onKey); } };
}
