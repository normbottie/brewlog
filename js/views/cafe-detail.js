/* One cafe — edit in place. */

import { getCafe, saveCafe, removeCafe, isForeign, membersById, canEdit, isWishlist } from '../store.js';
import { h, esc, icon, stars, bindStars, toast, confirmSheet, fmtDate, ownerBadge, goReplace } from '../ui.js';

export async function render(root, id) {
  const cafe = await getCafe(id);
  if (!cafe || cafe.deleted) {
    root.innerHTML = `<div class="view"><div class="empty glass card-pad">
      <h3>Café not found</h3><p>It may have been deleted.</p></div></div>`;
    return;
  }

  const hasPin = Number.isFinite(cafe.lat) && Number.isFinite(cafe.lng);
  const foreign = isForeign(cafe);
  const owner = foreign ? membersById().get(cafe.user_id) : null;
  // an admin may correct anyone's entry; for everyone else shared is read-only
  const locked = foreign && !canEdit(cafe);
  const want = isWishlist(cafe);

  const view = h(`<div>
    <div class="topbar">
      <button class="icon-btn" data-back aria-label="Back">${icon('back')}</button>
      <div class="spacer"></div>
      ${locked ? '' : `<button class="icon-btn btn-danger" data-del aria-label="Delete">${icon('trash')}</button>`}
    </div>
    <div class="view">
      <div class="glass card-pad" style="text-align:center">
        <div class="avatar" style="width:62px;height:62px;border-radius:20px;margin:2px auto 12px;
             display:grid;place-items:center;font-weight:700;font-size:24px;color:#1B1410;
             background:linear-gradient(163deg,var(--tan-bright),#A98A62)">
          ${esc((cafe.name || '?').trim().charAt(0).toUpperCase())}
        </div>
        <h2 style="margin:0;font-size:23px;letter-spacing:-.02em">${esc(cafe.name || 'Untitled')}</h2>
        <div class="hint" style="margin-top:5px">${esc(cafe.address || 'No address')}</div>
        ${want ? `<div class="chip chip-want" style="margin-top:14px">Not visited yet</div>
          ${locked ? '' : `<button class="btn-primary btn-block" data-visited style="margin-top:14px">
              Mark as visited
            </button>
            <div class="hint" style="margin-top:8px">Or rate it below — that counts as visiting.</div>`}` : ''}
        <div style="margin-top:14px" data-stars>${stars(cafe.rating, { size: 'lg', interactive: !locked })}</div>
        <div class="hint" style="margin-top:6px">${locked ? ''
          : want ? 'Rating it moves it to your visited list' : 'Tap to change the rating'}</div>
        ${foreign ? `<div class="read-only-note" style="margin-top:14px;justify-content:center">
          ${ownerBadge(owner)} <span>${locked ? 'Shared entry — read only'
            : 'Shared entry — you are editing it as an admin'}</span></div>` : ''}
      </div>

      ${hasPin ? `<div id="map" style="margin-top:16px;height:240px"></div>
        <div style="display:flex;gap:9px;margin-top:10px">
          <a class="btn btn-sm" style="flex:1" target="_blank" rel="noopener"
             href="https://www.openstreetmap.org/?mlat=${cafe.lat}&mlon=${cafe.lng}#map=17/${cafe.lat}/${cafe.lng}">Open in OSM</a>
          <a class="btn btn-sm" style="flex:1" target="_blank" rel="noopener"
             href="https://maps.apple.com/?ll=${cafe.lat},${cafe.lng}&q=${encodeURIComponent(cafe.name || 'Cafe')}">Directions</a>
        </div>` : ''}

      <h2 class="section">Notes</h2>
      <div class="glass card-pad">
        <textarea data-notes ${locked ? 'readonly' : ''} placeholder="What to order, seating, wifi…">${esc(cafe.notes)}</textarea>
        <div class="field-row" style="margin-top:12px">
          <div class="field" style="margin:0">
            <label for="c-visit">${want ? 'Visited on' : 'Last visited'}</label>
            <input id="c-visit" type="date" data-visit ${locked ? 'disabled' : ''} value="${esc(cafe.visited_on || '')}">
          </div>
        </div>
      </div>

      <div style="height:18px"></div>
      ${locked ? '' : '<button class="btn-primary btn-block" data-save>Save changes</button>'}
      <div class="hint" style="text-align:center;margin-top:12px">Added ${fmtDate(cafe.created_at)}</div>
    </div>
  </div>`);

  let rating = cafe.rating;
  const starBox = view.querySelector('[data-stars]');
  if (!locked) {
    bindStars(starBox, v => {
      rating = rating === v ? 0 : v;
      starBox.innerHTML = stars(rating, { size: 'lg', interactive: true });
    });
  }

  view.querySelector('[data-back]').onclick = () =>
    history.length > 1 ? history.back() : (location.hash = '#/cafes');

  view.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (await confirmSheet('Delete this café?', `“${cafe.name || 'Untitled'}” will be removed.`)) {
      await removeCafe(cafe.id);
      toast('Deleted');
      goReplace('#/cafes');
    }
  });

  view.querySelector('[data-visited]')?.addEventListener('click', async () => {
    cafe.visited_on = new Date().toISOString().slice(0, 10);
    cafe.notes = view.querySelector('[data-notes]').value;
    cafe.rating = rating;
    await saveCafe(cafe);
    toast('Marked as visited');
    document.dispatchEvent(new CustomEvent('brewlog:data'));
  });

  view.querySelector('[data-save]')?.addEventListener('click', async () => {
    cafe.rating = rating;
    cafe.notes = view.querySelector('[data-notes]').value;
    cafe.visited_on = view.querySelector('[data-visit]').value;
    // giving it stars means you have been, so date it if nothing else has
    if (rating && !cafe.visited_on) cafe.visited_on = new Date().toISOString().slice(0, 10);
    await saveCafe(cafe);
    toast('Saved');
    document.dispatchEvent(new CustomEvent('brewlog:data'));
  });

  root.appendChild(view);

  let map = null;
  if (hasPin && window.L) {
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView([cafe.lat, cafe.lng], 16);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, subdomains: 'abcd', attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(map);
    L.marker([cafe.lat, cafe.lng], {
      icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [30, 30], iconAnchor: [15, 28] }),
    }).addTo(map);
    setTimeout(() => map.invalidateSize(), 120);
  }

  return { destroy() { if (map) map.remove(); } };
}
