/* Cafes — map, list, star ratings. */

import { listCafes, saveCafe, blankCafe } from '../store.js';
import { h, esc, icon, stars, empty, sheet, toast, bindStars } from '../ui.js';
import { nearbyCafes, locate, formatDistance, distanceMeters } from '../places.js';

let mapRef = null;

export async function render(root) {
  const cafes = await listCafes();

  const view = h(`<div>
    <div class="topbar">
      <div>
        <h1>Cafes</h1>
        <div class="sub">${cafes.length} place${cafes.length === 1 ? '' : 's'} rated</div>
      </div>
      <div class="spacer"></div>
      <button class="icon-btn" data-add aria-label="Add cafe">${icon('plus')}</button>
    </div>
    <div class="view">
      <div id="map"></div>
      <button class="btn-primary btn-block" data-near style="margin-top:12px">
        ${icon('locate')} Cafes near me
      </button>
      <div class="hint" style="margin-top:8px">Or tap the map to drop a pin, or use + to search an address.</div>
      <div class="search-bar" style="margin-top:16px">
        ${icon('search')}
        <input type="search" placeholder="Search cafes and notes…" data-q>
      </div>
      <div data-list></div>
    </div>
  </div>`);

  const listEl = view.querySelector('[data-list]');
  const qEl = view.querySelector('[data-q]');

  function paint() {
    const q = qEl.value.trim().toLowerCase();
    const rows = cafes.filter(c => !q ||
      [c.name, c.address, c.notes].join(' ').toLowerCase().includes(q));
    if (!cafes.length) {
      listEl.innerHTML = empty('map', 'No cafes yet',
        'Add the places you drink at, rate them, and keep notes on what to order.');
      return;
    }
    if (!rows.length) { listEl.innerHTML = empty('search', 'Nothing matches', 'Try another search.'); return; }
    listEl.innerHTML = rows.map(c => `
      <button class="glass cafe-row" data-go="#/cafe/${esc(c.id)}">
        <div class="avatar">${esc((c.name || '?').trim().charAt(0).toUpperCase())}</div>
        <div class="body">
          <div class="nm">${esc(c.name || 'Untitled')}</div>
          <div class="addr">${esc(c.address || 'No address')}</div>
          <div style="margin-top:5px">${stars(c.rating)}</div>
        </div>
      </button>`).join('');
  }

  qEl.addEventListener('input', paint);
  listEl.addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (b) location.hash = b.dataset.go;
  });

  view.querySelector('[data-add]').onclick = () => addCafeSheet(null, cafes, paint);

  view.querySelector('[data-near]').onclick = async (e) => {
    const btn = e.currentTarget;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Finding you…`;
    try {
      const here = await locate();
      if (mapRef) mapRef.setView([here.lat, here.lng], 15);
      btn.innerHTML = `<span class="spinner"></span> Looking for cafes…`;
      const found = await nearbyCafes(here, 1500);
      showNearbySheet(found, here, cafes, paint);
    } catch (err) {
      toast(err.message || 'Could not find nearby cafes');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  };

  root.appendChild(view);
  paint();

  /* ---- map ---- */
  await whenLeaflet();
  const pinned = cafes.filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng));
  const map = L.map('map', { zoomControl: true, attributionControl: true })
    .setView(pinned.length ? [pinned[0].lat, pinned[0].lng] : [40.7128, -74.006], pinned.length ? 13 : 11);
  mapRef = map;

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);

  const pinIcon = L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [30, 30], iconAnchor: [15, 28] });

  const group = [];
  pinned.forEach(c => {
    const m = L.marker([c.lat, c.lng], { icon: pinIcon }).addTo(map);
    m.bindPopup(`<strong>${esc(c.name || 'Untitled')}</strong><br>
      <span style="color:#B4A392">${'★'.repeat(c.rating)}${'☆'.repeat(5 - c.rating)}</span><br>
      <a href="#/cafe/${esc(c.id)}" style="color:#E4C79A">Open</a>`);
    group.push([c.lat, c.lng]);
  });
  if (group.length > 1) map.fitBounds(group, { padding: [40, 40] });

  map.on('click', (e) => {
    addCafeSheet({ lat: e.latlng.lat, lng: e.latlng.lng }, cafes, paint);
  });

  setTimeout(() => map.invalidateSize(), 120);

  /* try to centre on the user, without nagging if denied */
  if (!pinned.length && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      p => map.setView([p.coords.latitude, p.coords.longitude], 14),
      () => {},
      { timeout: 6000 }
    );
  }

  return { destroy() { if (mapRef) { mapRef.remove(); mapRef = null; } } };
}

function whenLeaflet() {
  return new Promise(resolve => {
    const check = () => (window.L ? resolve() : setTimeout(check, 60));
    check();
  });
}

/* ------------------------------------------------------------------ */

/** Results from Overpass, with the ones you've already rated marked. */
function showNearbySheet(found, here, cafes, onDone) {
  if (!found.length) {
    toast('No cafes mapped within 1.5 km — drop a pin instead');
    return;
  }

  sheet(`${found.length} cafe${found.length === 1 ? '' : 's'} near you`, (close) => {
    const already = (c) =>
      cafes.find(x => Number.isFinite(x.lat) &&
        distanceMeters({ lat: x.lat, lng: x.lng }, { lat: c.lat, lng: c.lng }) < 60);

    const node = h(`<div>
      <div class="hint" style="margin:-6px 0 14px">
        From OpenStreetMap. Tap one to rate it. Missing somewhere? Close this and tap the map.
      </div>
      <div data-rows></div>
    </div>`);

    node.querySelector('[data-rows]').innerHTML = found.map((c, i) => {
      const mine = already(c);
      return `<button class="glass cafe-row" data-i="${i}">
        <div class="avatar">${esc(c.name.trim().charAt(0).toUpperCase())}</div>
        <div class="body">
          <div class="nm">${esc(c.name)}</div>
          <div class="addr">${esc(c.address || c.tags?.['addr:street'] || 'No address on file')}</div>
          ${mine ? `<div style="margin-top:5px">${stars(mine.rating)}</div>` : ''}
        </div>
        <div style="flex:0 0 auto;text-align:right">
          <div class="chip chip-muted">${esc(formatDistance(c.distance))}</div>
          ${mine ? '<div class="hint" style="margin-top:5px">rated</div>' : ''}
        </div>
      </button>`;
    }).join('');

    node.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-i]');
      if (!btn) return;
      const c = found[Number(btn.dataset.i)];
      const mine = already(c);
      close();
      if (mine) { location.hash = `#/cafe/${mine.id}`; return; }
      addCafeSheet({ name: c.name, address: c.address, lat: c.lat, lng: c.lng }, cafes, onDone);
    });

    void here;
    return node;
  });
}

export function addCafeSheet(seed, cafes, onDone) {
  const cafe = { ...blankCafe(), ...(seed || {}) };
  let rating = 0;

  sheet('Add a cafe', (close) => {
    const node = h(`<div>
      <div class="field">
        <label for="c-name">Name</label>
        <input id="c-name" data-n placeholder="e.g. Sey Coffee" value="${esc(cafe.name || '')}">
      </div>
      <div class="field">
        <label for="c-addr">Address</label>
        <div style="display:flex;gap:9px">
          <input id="c-addr" data-a placeholder="Street, city" value="${esc(cafe.address || '')}">
          <button type="button" class="btn-sm" data-find style="flex:0 0 auto">Find</button>
        </div>
        <div class="hint" data-geo>${seed && Number.isFinite(seed.lat)
          ? `Pin set: ${seed.lat.toFixed(4)}, ${seed.lng.toFixed(4)}`
          : 'Search an address, or tap the map to drop a pin.'}</div>
      </div>
      <div class="field">
        <label>Rating</label>
        <div data-stars>${stars(0, { size: 'lg', interactive: true })}</div>
      </div>
      <div class="field">
        <label for="c-notes">Notes</label>
        <textarea id="c-notes" data-notes placeholder="What to order, seating, wifi, who roasts their beans…"></textarea>
      </div>
      <button class="btn-primary btn-block" data-save>Save cafe</button>
    </div>`);

    const starBox = node.querySelector('[data-stars]');
    bindStars(starBox, v => {
      rating = rating === v ? 0 : v;
      starBox.innerHTML = stars(rating, { size: 'lg', interactive: true });
    });

    const geoHint = node.querySelector('[data-geo]');
    node.querySelector('[data-find]').onclick = async (e) => {
      const q = node.querySelector('[data-a]').value.trim();
      if (!q) { toast('Type an address first'); return; }
      e.currentTarget.disabled = true;
      geoHint.innerHTML = '<span class="busy"><span class="spinner"></span>Looking it up…</span>';
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`
        );
        const [hit] = await res.json();
        if (!hit) { geoHint.textContent = 'No match — try a fuller address, or tap the map instead.'; return; }
        cafe.lat = parseFloat(hit.lat);
        cafe.lng = parseFloat(hit.lon);
        cafe.address = hit.display_name;
        node.querySelector('[data-a]').value = hit.display_name;
        geoHint.textContent = `Found: ${cafe.lat.toFixed(4)}, ${cafe.lng.toFixed(4)}`;
        if (mapRef) mapRef.setView([cafe.lat, cafe.lng], 16);
      } catch {
        geoHint.textContent = 'Lookup failed — check your connection, or tap the map.';
      } finally {
        e.currentTarget.disabled = false;
      }
    };

    node.querySelector('[data-save]').onclick = async () => {
      cafe.name = node.querySelector('[data-n]').value.trim();
      cafe.address = node.querySelector('[data-a]').value.trim();
      cafe.notes = node.querySelector('[data-notes]').value;
      cafe.rating = rating;
      if (!cafe.name) { toast('Give the cafe a name'); return; }
      await saveCafe(cafe);
      cafes.unshift(cafe);
      close();
      toast('Cafe saved');
      onDone && onDone();
      if (location.hash.startsWith('#/cafes')) {
        document.dispatchEvent(new CustomEvent('brewlog:data'));
      } else {
        location.hash = '#/cafes';
      }
    };

    return node;
  });
}
