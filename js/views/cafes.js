/* Cafes — map, list, star ratings. */

import { listCafes, saveCafe, blankCafe, membersById, sharingMembers, isForeign } from '../store.js';
import { h, esc, icon, stars, empty, sheet, toast, bindStars, ownerBadge, memberColor } from '../ui.js';
import { findCafesAround, searchPlacesByName, locate, formatDistance, distanceMeters } from '../places.js';
import { clusterLayer } from '../cluster.js';

let mapRef = null;
let clusters = null;

const scope = { shared: false };
const LS_SHARED = 'brewlog.scope.cafes';
try { scope.shared = localStorage.getItem(LS_SHARED) === '1'; } catch {}

export async function render(root) {
  const others = sharingMembers();
  if (!others.length) scope.shared = false;
  const cafes = await listCafes({ shared: scope.shared });
  const members = membersById();

  const view = h(`<div>
    <div class="topbar">
      <div>
        <h1>Cafés</h1>
        <div class="sub">${cafes.length} place${cafes.length === 1 ? '' : 's'} rated</div>
      </div>
      <div class="spacer"></div>
      <button class="icon-btn" data-add aria-label="Add cafe">${icon('plus')}</button>
    </div>
    <div class="view">
      <div id="map"></div>
      <div style="display:flex;gap:9px;margin-top:12px">
        <button class="btn-primary" style="flex:1;white-space:nowrap" data-near>
          ${icon('locate')} Near me
        </button>
        <button data-here style="flex:1;white-space:nowrap">This map area</button>
      </div>
      <div class="hint" data-nearstatus style="margin-top:8px">Or tap anywhere on the map to drop a pin — you can drag it to fine-tune, and close the sheet to cancel.</div>
      <div class="search-bar" style="margin-top:16px">
        ${icon('search')}
        <input type="search" placeholder="Search your cafés…" data-q>
      </div>
      <div data-findweb></div>
      ${others.length ? `<div class="scope-toggle" data-scope>
        <button data-sc="mine" aria-pressed="${!scope.shared}">Mine</button>
        <button data-sc="all" aria-pressed="${scope.shared}">Everyone</button>
      </div>` : ''}
      <div data-list></div>
    </div>
  </div>`);

  const listEl = view.querySelector('[data-list]');
  const qEl = view.querySelector('[data-q]');
  const findWeb = view.querySelector('[data-findweb]');

  /* The search box only knows about places you've already logged, so give
     the same query somewhere to go when you're looking for one you haven't. */
  function paintFindWeb() {
    const q = qEl.value.trim();
    findWeb.innerHTML = q
      ? `<button class="btn-sm btn-block" data-osm style="margin-top:12px">
           ${icon('search')} Look up “${esc(q)}” on the map
         </button>`
      : '';
  }

  function paint() {
    paintFindWeb();
    const q = qEl.value.trim().toLowerCase();
    const rows = cafes.filter(c => !q ||
      [c.name, c.address, c.notes].join(' ').toLowerCase().includes(q));
    if (!cafes.length) {
      listEl.innerHTML = empty('map', 'No cafés yet',
        'Add the places you drink at, rate them, and keep notes on what to order.');
      return;
    }
    if (!rows.length) {
      listEl.innerHTML = empty('search', 'None of yours match',
        'You haven’t rated this one yet — look it up on the map to add it.');
      return;
    }
    listEl.innerHTML = rows.map(c => {
      const foreign = isForeign(c);
      const owner = foreign ? members.get(c.user_id) : null;
      return `
      <button class="glass cafe-row ${foreign ? 'shared' : ''}"
        ${foreign ? `style="--owner:${memberColor(owner?._slot ?? -1)}"` : ''}
        data-go="#/cafe/${esc(c.id)}">
        <div class="avatar">${esc((c.name || '?').trim().charAt(0).toUpperCase())}</div>
        <div class="body">
          <div class="nm">${esc(c.name || 'Untitled')}</div>
          <div class="addr">${esc(c.address || 'No address')}</div>
          <div style="margin-top:5px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            ${stars(c.rating)}${foreign ? ownerBadge(owner) : ''}
          </div>
        </div>
      </button>`;
    }).join('');
  }

  qEl.addEventListener('input', paint);

  view.querySelector('[data-scope]')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sc]');
    if (!b) return;
    scope.shared = b.dataset.sc === 'all';
    try { localStorage.setItem(LS_SHARED, scope.shared ? '1' : '0'); } catch {}
    document.dispatchEvent(new CustomEvent('brewlog:data'));
  });
  listEl.addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (b) location.hash = b.dataset.go;
  });

  view.querySelector('[data-add]').onclick = () => addCafeSheet(null, cafes, paint);

  const nearStatus = view.querySelector('[data-nearstatus]');

  /* Show the area that was actually searched. Without this the map kept its
     own zoom, so results outside the visible box looked like a bug. */
  let searchRing = null;
  function showSearchArea(point, radius) {
    if (!mapRef) return;
    if (searchRing) mapRef.removeLayer(searchRing);
    searchRing = L.circle([point.lat, point.lng], {
      radius,
      color: '#E4C79A', weight: 1, opacity: 0.55,
      fillColor: '#E4C79A', fillOpacity: 0.07,
      interactive: false,
    }).addTo(mapRef);
    mapRef.fitBounds(searchRing.getBounds(), { padding: [22, 22] });
  }

  async function runSearch(btn, getPoint, label) {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${label}`;
    nearStatus.innerHTML = `<span class="busy"><span class="spinner"></span>Searching OpenStreetMap…</span>`;
    try {
      const point = await getPoint();
      // pan, but keep the zoom the user chose — the fit comes after,
      // once we know how far the search actually reached
      if (mapRef) mapRef.setView([point.lat, point.lng], mapRef.getZoom());
      const { results, radius } = await findCafesAround(point);
      showSearchArea(point, radius);
      const where = `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
      if (!results.length) {
        nearStatus.innerHTML =
          `No cafés are mapped within ${esc(formatDistance(radius))} of ${esc(where)}. That is ` +
          `OpenStreetMap's coverage, not an error — tap the map to add one yourself.`;
        return;
      }
      nearStatus.textContent =
        `${results.length} found within ${formatDistance(radius)} of ${where} — the circled area.`;
      showNearbySheet(results, cafes, paint);
    } catch (err) {
      nearStatus.textContent = err.message || 'Could not search for cafés';
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  /* Look a place up by name, whether or not it's near the map. */
  findWeb.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-osm]');
    if (!btn) return;
    const q = qEl.value.trim();
    if (!q) return;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Looking up “${esc(q)}”…`;
    nearStatus.innerHTML = `<span class="busy"><span class="spinner"></span>Searching OpenStreetMap…</span>`;
    try {
      const near = mapRef ? (({ lat, lng }) => ({ lat, lng }))(mapRef.getCenter()) : null;
      const found = await searchPlacesByName(q, near);
      if (!found.length) {
        nearStatus.textContent =
          `Nothing within reach of the map matches “${q}”. Pan the map to the right ` +
          `area and try again, or tap the map to place it yourself.`;
        return;
      }
      nearStatus.textContent = `${found.length} place${found.length === 1 ? '' : 's'} match “${q}”.`;
      if (mapRef) {
        if (searchRing) { mapRef.removeLayer(searchRing); searchRing = null; }
        mapRef.setView([found[0].lat, found[0].lng], Math.max(mapRef.getZoom(), 14));
      }
      showNearbySheet(found, cafes, paint, {
        title: `Matches for “${q}”`,
        hint: 'From OpenStreetMap. Tap one to rate it — it gets added to your cafés.',
      });
    } catch (err) {
      nearStatus.textContent = err.message || 'Could not search for places';
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

  view.querySelector('[data-near]').onclick = (e) =>
    runSearch(e.currentTarget, () => locate(), 'Finding you…');

  view.querySelector('[data-here]').onclick = (e) =>
    runSearch(e.currentTarget, async () => {
      if (!mapRef) throw new Error('Map is still loading');
      const c = mapRef.getCenter();
      return { lat: c.lat, lng: c.lng };
    }, 'Searching…');

  root.appendChild(view);
  paint();

  /* ---- map ---- */
  await whenLeaflet();
  const pinned = cafes.filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng));
  const map = L.map('map', {
    zoomControl: true,
    attributionControl: true,
    doubleClickZoom: true,   // stated, since a click handler shares the gesture
    tap: true,
  })
    .setView(pinned.length ? [pinned[0].lat, pinned[0].lng] : [40.7128, -74.006], pinned.length ? 13 : 11);
  mapRef = map;
  /* A seam for the tests: clustering is a function of zoom, and driving
     that through the zoom control one click at a time makes for a test
     that checks the control more than the clustering. Reading only. */
  window.__brewlogMap = map;

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    subdomains: 'abcd',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  }).addTo(map);

  const pinIcon = L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [30, 30], iconAnchor: [15, 28] });
  const ownerPin = (c) => {
    if (!isForeign(c)) return pinIcon;
    const color = memberColor(members.get(c.user_id)?._slot ?? -1);
    return L.divIcon({
      className: '',
      html: `<div class="pin" style="background:${color}"></div>`,
      iconSize: [30, 30], iconAnchor: [15, 28],
    });
  };

  /* Pins that overlap are merged into a count, splitting apart as you zoom
     in — a dozen cafés in one neighbourhood were otherwise a single
     unreadable pile. */
  const pinFor = (c) => {
    const m = L.marker([c.lat, c.lng], { icon: ownerPin(c) });
    const who = isForeign(c) ? members.get(c.user_id)?.display_name || 'Member' : null;
    m.bindPopup(`<strong>${esc(c.name || 'Untitled')}</strong><br>
      <span style="color:#B4A392">${'★'.repeat(c.rating)}${'☆'.repeat(5 - c.rating)}</span><br>
      ${who ? `<span style="color:#B4A392">rated by ${esc(who)}</span><br>` : ''}
      <a href="#/cafe/${esc(c.id)}" style="color:#E4C79A">Open</a>`);
    return m;
  };

  const clusterIcon = (group) => {
    const size = group.length > 24 ? 46 : group.length > 8 ? 41 : 36;
    return L.divIcon({
      className: '',
      html: `<div class="pin-cluster" style="width:${size}px;height:${size}px">${group.length}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  };

  clusters = clusterLayer(map, { marker: pinFor, clusterIcon });
  clusters.set(pinned);

  if (pinned.length > 1) {
    map.fitBounds(pinned.map(c => [c.lat, c.lng]), { padding: [40, 40] });
  }

  /* Tapping the map drops a draggable pin you can nudge into place; the
     details sheet opens alongside it, and the pin clears if you cancel.

     Held back a beat, because a double tap is two clicks: without the delay
     the first one opened the add-a-café sheet over the top of the zoom you
     were actually asking for. */
  let draft = null;
  let dropTimer = null;

  map.on('dblclick', () => { clearTimeout(dropTimer); dropTimer = null; });
  map.on('click', (e) => { clearTimeout(dropTimer); dropTimer = setTimeout(() => dropPin(e), 260); });

  function dropPin(e) {
    dropTimer = null;
    if (draft) map.removeLayer(draft);
    draft = L.marker(e.latlng, { icon: pinIcon, draggable: true, autoPan: true }).addTo(map);
    draft.bindTooltip('Drag me to adjust', { permanent: true, direction: 'top', offset: [0, -26] }).openTooltip();

    let openSheetHandle = null;
    const openSheet = () => {
      openSheetHandle?.close();
      const p = draft.getLatLng();
      openSheetHandle = addCafeSheet({ lat: p.lat, lng: p.lng }, cafes, () => {
        if (draft) { map.removeLayer(draft); draft = null; }
        paint();
      });
    };

    // moving the pin reopens the sheet with the new coordinates
    draft.on('dragstart', () => openSheetHandle?.close());
    draft.on('dragend', openSheet);
    openSheet();
  }

  setTimeout(() => map.invalidateSize(), 120);

  /* try to centre on the user, without nagging if denied */
  if (!pinned.length && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      p => map.setView([p.coords.latitude, p.coords.longitude], 14),
      () => {},
      { timeout: 6000 }
    );
  }

  return {
    destroy() {
      clusters = null;   // its layer goes with the map
      if (mapRef) { mapRef.remove(); mapRef = null; }
    },
  };
}

function whenLeaflet() {
  return new Promise(resolve => {
    const check = () => (window.L ? resolve() : setTimeout(check, 60));
    check();
  });
}

/* ------------------------------------------------------------------ */

/** OpenStreetMap results, with the ones you've already rated marked. */
function showNearbySheet(found, cafes, onDone, opts = {}) {
  if (!found.length) return;
  const title = opts.title || `${found.length} café${found.length === 1 ? '' : 's'} nearby`;
  const hint = opts.hint ||
    'From OpenStreetMap. Tap one to rate it. Missing somewhere? Close this and tap the map.';

  sheet(title, (close) => {
    const already = (c) =>
      cafes.find(x => Number.isFinite(x.lat) &&
        distanceMeters({ lat: x.lat, lng: x.lng }, { lat: c.lat, lng: c.lng }) < 60);

    const node = h(`<div>
      <div class="hint" style="margin:-6px 0 14px">${esc(hint)}</div>
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
          ${Number.isFinite(c.distance) ? `<div class="chip chip-muted">${esc(formatDistance(c.distance))}</div>` : ''}
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

    return node;
  });
}

export function addCafeSheet(seed, cafes, onDone) {
  const cafe = { ...blankCafe(), ...(seed || {}) };
  let rating = 0;

  return sheet('Add a café', (close) => {
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
      if (!cafe.name) { toast('Give the café a name'); return; }
      await saveCafe(cafe);
      cafes.unshift(cafe);
      close();
      toast('Café saved');
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
