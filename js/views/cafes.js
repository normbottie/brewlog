/* Cafes — map, list, star ratings. */

import { listCafes, saveCafe, blankCafe, membersById, sharingMembers, isForeign, isWishlist } from '../store.js';
import { h, esc, icon, stars, empty, sheet, toast, bindStars, ownerBadge, memberColor } from '../ui.js';
import { nearbyCafes, searchPlacesByName, locate, formatDistance, distanceMeters } from '../places.js';
import { clusterLayer } from '../cluster.js';
import { matches } from '../search.js';
import { STADIA_API_KEY } from '../config.js';

let mapRef = null;
let clusters = null;

const scope = { shared: false };
const LS_SHARED = 'brewlog.scope.cafes';
const LS_SORT = 'brewlog.sort.cafes';
/* 'visited' = most recently visited first, 'name' = A-Z. */
let sortBy = 'visited';
try { if (localStorage.getItem(LS_SORT) === 'name') sortBy = 'name'; } catch {}
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
        <div class="sub">${(() => {
          const w = cafes.filter(isWishlist).length;
          const v = cafes.length - w;
          return [v ? `${v} visited` : '', w ? `${w} to try` : ''].filter(Boolean).join(' · ') || 'Nothing yet';
        })()}</div>
      </div>
      <div class="spacer"></div>
      <button class="icon-btn" data-add aria-label="Add cafe">${icon('plus')}</button>
    </div>
    <div class="view">
      <div id="map"></div>
      <div style="display:flex;gap:9px;margin-top:12px">
        <button class="btn-primary" style="flex:1;white-space:nowrap" data-near>
          ${icon('locate')} Walking distance
        </button>
        <button data-here style="flex:1;white-space:nowrap">This map area</button>
      </div>
      <div class="area-bar" data-areabar hidden>
        <button class="btn-primary" style="flex:1" data-runsearch>Search this area</button>
        <button style="flex:0 0 auto" data-cancelarea>Cancel</button>
      </div>
      <div class="hint" data-nearstatus style="margin-top:8px">Or tap anywhere on the map to drop a pin — you can drag it to fine-tune, and close the sheet to cancel.</div>
      <div class="search-bar" style="margin-top:16px">
        ${icon('search')}
        <input type="search" placeholder="Search your cafés…" data-q>
      </div>
      <div data-findweb></div>
      <div class="scope-toggle" data-sort style="margin-top:12px">
        <button data-sb="visited" aria-pressed="${sortBy === 'visited'}">Last visited</button>
        <button data-sb="name" aria-pressed="${sortBy === 'name'}">A–Z</button>
      </div>
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

  /* A-Z is a plain name sort. "Last visited" reads visited_on, which is a
     date-only string, so same-day visits would otherwise come back in
     whatever order IndexedDB handed them over — updated_at breaks the tie. */
  function sorted(rows) {
    const copy = rows.slice();
    if (sortBy === 'name') {
      copy.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined,
        { sensitivity: 'base', numeric: true }));
    } else {
      copy.sort((a, b) =>
        (b.visited_on || '').localeCompare(a.visited_on || '') ||
        (b.updated_at || '').localeCompare(a.updated_at || ''));
    }
    return copy;
  }

  function paint() {
    paintFindWeb();
    /* Folded on both sides. The apostrophe iOS substitutes as you type (’)
       and the one on the keyboard (') are the same character as far as
       finding "Sweet Caroline's" goes, and so is leaving it out. */
    const rows = cafes.filter(c => matches([c.name, c.address, c.notes], qEl.value));
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
    /* Places you mean to try are a different kind of thing from places you
       have an opinion about, so they get their own section rather than
       sitting in the list behind an empty row of stars. */
    const want = sorted(rows.filter(isWishlist));
    const been = sorted(rows.filter(c => !isWishlist(c)));
    listEl.innerHTML =
      (want.length ? `<h2 class="section">Want to visit · ${want.length}</h2>${cards(want)}` : '') +
      (been.length
        ? `${want.length ? `<h2 class="section">Visited · ${been.length}</h2>` : ''}${cards(been)}`
        : '');
  }

  function cards(rows) {
    return rows.map(c => {
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
            ${isWishlist(c) ? '<span class="chip chip-want">Not visited yet</span>' : stars(c.rating)}
            ${foreign ? ownerBadge(owner) : ''}
          </div>
        </div>
      </button>`;
    }).join('');
  }

  qEl.addEventListener('input', paint);

  /* Sort is a view preference, not a data change: repaint the list rather
     than dispatching brewlog:data, which would re-route and rebuild the map. */
  view.querySelector('[data-sort]')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sb]');
    if (!b || b.dataset.sb === sortBy) return;
    sortBy = b.dataset.sb;
    try { localStorage.setItem(LS_SORT, sortBy); } catch {}
    view.querySelectorAll('[data-sb]').forEach(el => {
      el.setAttribute('aria-pressed', String(el.dataset.sb === sortBy));
    });
    paint();
  });

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

  /* ---- the search area -------------------------------------------------
     The circle used to appear *after* a search, to explain where the results
     had come from — and the radius was chosen for you, escalating from 2.4km
     to 8km until something turned up. So "Near me" could quietly search five
     miles. Now the circle comes first and is yours: drag the middle to move
     it, drag the grip on its edge to resize, and nothing is queried until you
     say so. What you see is exactly what gets searched. */
  const areaBar = view.querySelector('[data-areabar]');
  const MIN_R = 150, MAX_R = 10000;
  const WALKING = 800;                       // ~half a mile
  let area = null;                           // { center: L.LatLng, radius: m }
  let areaCircle = null, centerGrip = null, edgeGrip = null;

  const clampR = (r) => Math.min(MAX_R, Math.max(MIN_R, r));
  const gripIcon = (cls) => L.divIcon({
    className: '', html: `<div class="${cls}"></div>`, iconSize: [26, 26], iconAnchor: [13, 13],
  });

  /* A point `meters` due east of centre — where the resize grip parks. */
  function eastOf(center, meters) {
    const perDeg = 111320 * Math.cos(center.lat * Math.PI / 180);
    return L.latLng(center.lat, center.lng + meters / (perDeg || 1));
  }

  function areaLabel() {
    const btn = view.querySelector('[data-runsearch]');
    if (btn && area && !btn.disabled) {
      btn.textContent = `Search this area · ${formatDistance(area.radius)}`;
    }
  }

  function clearArea() {
    [areaCircle, centerGrip, edgeGrip].forEach(l => { if (l && mapRef) mapRef.removeLayer(l); });
    areaCircle = centerGrip = edgeGrip = null;
    area = null;
    areaBar.hidden = true;
  }

  function setArea(center, radius) {
    if (!mapRef) return;
    clearArea();
    area = { center: L.latLng(center.lat, center.lng), radius: clampR(radius) };

    areaCircle = L.circle(area.center, {
      radius: area.radius,
      color: '#E4C79A', weight: 1.5, opacity: .8,
      fillColor: '#E4C79A', fillOpacity: .09,
      interactive: false,
    }).addTo(mapRef);

    centerGrip = L.marker(area.center, {
      icon: gripIcon('area-dot'), draggable: true, zIndexOffset: 900,
    }).addTo(mapRef);
    edgeGrip = L.marker(eastOf(area.center, area.radius), {
      icon: gripIcon('area-grip'), draggable: true, zIndexOffset: 900,
    }).addTo(mapRef);

    centerGrip.on('drag', () => {
      area.center = centerGrip.getLatLng();
      areaCircle.setLatLng(area.center);
      edgeGrip.setLatLng(eastOf(area.center, area.radius));
    });
    edgeGrip.on('drag', () => {
      area.radius = clampR(mapRef.distance(area.center, edgeGrip.getLatLng()));
      areaCircle.setRadius(area.radius);
      areaLabel();
    });
    /* Snap the grip back to due east on release, so it doesn't drift round
       the circle and become hard to find next time. */
    edgeGrip.on('dragend', () => edgeGrip.setLatLng(eastOf(area.center, area.radius)));

    areaBar.hidden = false;
    areaLabel();
    nearStatus.textContent =
      'Drag the middle to move the circle, or the grip on its edge to resize. Nothing is searched until you tap Search.';
    mapRef.fitBounds(areaCircle.getBounds(), { padding: [30, 30] });
  }

  async function runSearch(btn) {
    if (!area) return;
    const point = { lat: area.center.lat, lng: area.center.lng };
    const radius = area.radius;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Searching…`;
    nearStatus.innerHTML = `<span class="busy"><span class="spinner"></span>Searching OpenStreetMap…</span>`;
    try {
      const results = await nearbyCafes(point, radius);
      if (!results.length) {
        nearStatus.innerHTML =
          `No cafés are mapped inside that circle. That is OpenStreetMap's coverage, not ` +
          `an error — widen the circle and search again, or tap the map to add one yourself.`;
        return;
      }
      nearStatus.textContent =
        `${results.length} found within ${formatDistance(radius)} of the circle's centre.`;
      showNearbySheet(results, cafes, paint);
    } catch (err) {
      nearStatus.textContent = err.message || 'Could not search for cafés';
    } finally {
      btn.disabled = false;
      areaLabel();
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

  /* Both buttons only *place* a circle. Neither searches. */
  view.querySelector('[data-near]').onclick = async (e) => {
    const btn = e.currentTarget;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Finding you…`;
    try {
      setArea(await locate(), WALKING);
    } catch (err) {
      nearStatus.textContent = err.message || 'Could not find you';
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  };

  view.querySelector('[data-here]').onclick = () => {
    if (!mapRef) { nearStatus.textContent = 'Map is still loading'; return; }
    const c = mapRef.getCenter();
    const b = mapRef.getBounds();
    /* the largest circle that still fits on screen */
    const r = Math.min(
      mapRef.distance(c, L.latLng(b.getNorth(), c.lng)),
      mapRef.distance(c, L.latLng(c.lat, b.getEast())),
    );
    setArea({ lat: c.lat, lng: c.lng }, r);
  };

  view.querySelector('[data-cancelarea]').onclick = () => {
    clearArea();
    nearStatus.textContent = '';
  };

  view.querySelector('[data-runsearch]').onclick = (e) => runSearch(e.currentTarget);

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

  /* Stadia's "Alidade Smooth Dark" vector style, not Esri's Dark Gray Canvas:
     Esri's free tiles are a fixed 256px/96dpi raster with no @2x variant, so
     they looked soft on any retina screen — a limit of that source, not a
     bug. MapLibre GL renders the vectors itself, so it's sharp at any zoom
     and any device pixel ratio. Needs a free Stadia key (STADIA_API_KEY in
     config.js); attributionControl:false because Leaflet already draws one
     (added below) — two attribution controls would stack. */
  L.maplibreGL({
    style: `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${STADIA_API_KEY}`,
    attributionControl: false,
  }).addTo(map);
  map.attributionControl.addAttribution(
    '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; OpenStreetMap contributors'
  );

  const pinIcon = L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [30, 30], iconAnchor: [15, 28] });
  /* A hollow pin reads as "not been there yet" without needing a legend. */
  const ownerPin = (c) => {
    const want = isWishlist(c);
    if (!isForeign(c)) {
      if (!want) return pinIcon;
      return L.divIcon({ className: '', html: '<div class="pin want"></div>',
                         iconSize: [30, 30], iconAnchor: [15, 28] });
    }
    const color = memberColor(members.get(c.user_id)?._slot ?? -1);
    return L.divIcon({
      className: '',
      html: `<div class="pin${want ? ' want' : ''}" style="${
        want ? `border-color:${color};color:${color}` : `background:${color}`}"></div>`,
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
      <label class="share-row" style="margin-bottom:4px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:15px">Want to visit</div>
          <div class="hint" style="margin:2px 0 0">
            Somewhere to try. It moves to your visited list once you rate it.
          </div>
        </div>
        <input type="checkbox" data-want>
        <span class="switch"></span>
      </label>

      <div class="field" data-ratefield>
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

    /* Rating something you have not been to makes no sense, so the toggle
       hides the stars rather than leaving them there to be misread. */
    const wantEl = node.querySelector('[data-want]');
    const rateField = node.querySelector('[data-ratefield]');
    wantEl.addEventListener('change', () => {
      rateField.hidden = wantEl.checked;
      if (wantEl.checked) {
        rating = 0;
        starBox.innerHTML = stars(0, { size: 'lg', interactive: true });
      }
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
      cafe.rating = wantEl.checked ? 0 : rating;
      // no visit date is what marks it as somewhere you still mean to go
      cafe.visited_on = wantEl.checked ? '' : (cafe.visited_on || new Date().toISOString().slice(0, 10));
      if (!cafe.name) { toast('Give the café a name'); return; }
      await saveCafe(cafe);
      cafes.unshift(cafe);
      close();
      toast(wantEl.checked ? 'Added to want to visit' : 'Café saved');
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
