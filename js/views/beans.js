/* Beans list — search, filter, grid of uniform bag shots. */

import {
  listBeans, beanImageURL, syncState, membersById, sharingMembers, isForeign,
  SCOPE_KEYS, scopeShared, brewCounts,
} from '../store.js';
import { h, esc, icon, stars, empty, ownerBadge, memberColor } from '../ui.js';
import { radarMini } from '../radar.js';

const LS_SHARED = SCOPE_KEYS.beans;
const state = { q: '', filter: 'all', shared: scopeShared('beans') };

export async function render(root) {
  const others = sharingMembers();
  if (!others.length) state.shared = false;
  const beans = await listBeans({ shared: state.shared });
  const members = membersById();
  const brewsPerBag = await brewCounts();

  const roasters = [...new Set(beans.map(b => b.roaster).filter(Boolean))].sort();
  const brews = [...new Set(beans.map(b => b.brew_method).filter(Boolean))].sort();

  const view = h(`<div>
    <div class="topbar">
      <div>
        <h1>Brewlog</h1>
        <div class="sub">${beans.length} bag${beans.length === 1 ? '' : 's'} logged</div>
      </div>
      <div class="spacer"></div>
      <span class="sync-dot ${syncState.status === 'on' ? 'on' : syncState.status === 'err' ? 'err' : ''}"
            data-sync-dot title="${esc(syncState.message)}"></span>
      <button class="icon-btn" data-new aria-label="Log a new bag">${icon('plus')}</button>
    </div>
    <div class="view">
      <div class="search-bar">
        ${icon('search')}
        <input type="search" placeholder="Search beans, roasters, notes…" value="${esc(state.q)}" data-q>
      </div>
      ${others.length ? `<div class="scope-toggle" data-scope>
        <button data-sc="mine" aria-pressed="${!state.shared}">Mine</button>
        <button data-sc="all" aria-pressed="${state.shared}">Everyone</button>
      </div>` : ''}
      <div class="filter-scroll" data-filters></div>
      <div data-results></div>
      <button class="btn-primary btn-block" data-new2 style="margin-top:18px">
        ${icon('plus')} Log a new bag
      </button>
    </div>
  </div>`);

  const filters = [
    { k: 'all', label: 'All' },
    { k: 'top', label: '★ 4+' },
    ...brews.map(b => ({ k: 'brew:' + b, label: b })),
    ...roasters.map(r => ({ k: 'roaster:' + r, label: r })),
  ];

  const fEl = view.querySelector('[data-filters]');
  fEl.innerHTML = filters.map(f =>
    `<button data-f="${esc(f.k)}" aria-pressed="${state.filter === f.k}">${esc(f.label)}</button>`).join('');
  fEl.addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    state.filter = b.dataset.f;
    fEl.querySelectorAll('[data-f]').forEach(x =>
      x.setAttribute('aria-pressed', String(x.dataset.f === state.filter)));
    paint();
  });

  const qEl = view.querySelector('[data-q]');
  qEl.addEventListener('input', () => { state.q = qEl.value; paint(); });

  view.querySelector('[data-scope]')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sc]');
    if (!b) return;
    state.shared = b.dataset.sc === 'all';
    try { localStorage.setItem(LS_SHARED, state.shared ? '1' : '0'); } catch {}
    document.dispatchEvent(new CustomEvent('brewlog:data'));
  });

  const results = view.querySelector('[data-results]');

  function match(b) {
    const q = state.q.trim().toLowerCase();
    if (q) {
      const hay = [b.name, b.roaster, b.origin, b.region, b.process, b.varietal,
        b.notes, b.brew_method, (b.flavor_notes || []).join(' ')]
        .join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    const f = state.filter;
    if (f === 'all') return true;
    if (f === 'top') return (b.overall || 0) >= 4;
    if (f.startsWith('brew:')) return b.brew_method === f.slice(5);
    if (f.startsWith('roaster:')) return b.roaster === f.slice(8);
    return true;
  }

  function paint() {
    const rows = beans.filter(match);
    if (!beans.length) {
      results.innerHTML = empty('bean', 'No beans yet',
        'Photograph your first bag and record how it tasted.');
      return;
    }
    if (!rows.length) {
      results.innerHTML = empty('search', 'Nothing matches',
        'Try a different search term or clear the filter.');
      return;
    }
    results.innerHTML = `<div class="bean-grid">${rows.map(card).join('')}</div>`;
    rows.forEach(async b => {
      const url = await beanImageURL(b);
      if (!url) return;
      const img = results.querySelector(`[data-img="${b.id}"]`);
      if (img) img.src = url;
    });
  }

  function card(b) {
    const foreign = isForeign(b);
    const owner = foreign ? members.get(b.user_id) : null;
    return `<button class="glass bean-card ${foreign ? 'shared' : ''}"
        ${foreign ? `style="--owner:${memberColor(owner?._slot ?? -1)}"` : ''}
        data-go="#/bean/${esc(b.id)}">
      ${brewsPerBag.get(b.id) ? `<span class="brew-count" aria-label="${brewsPerBag.get(b.id)} brews logged">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z"/>
          <path d="M16 10h1.6a2.4 2.4 0 0 1 0 4.8H16"/></svg>${brewsPerBag.get(b.id)}</span>` : ''}
      <img class="shot" data-img="${esc(b.id)}" alt="${esc(b.name || 'Coffee bag')}"
           src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
      <div class="meta">
        <div class="name">${esc(b.name || 'Untitled')}</div>
        <div class="roaster">${esc(b.roaster || '—')}</div>
        ${foreign ? `<div style="margin-top:5px">${ownerBadge(owner)}</div>` : ''}
        <div class="row">
          ${radarMini(b.ratings)}
          <div style="flex:1;min-width:0">
            ${b.overall ? stars(b.overall) : ''}
            <div class="roaster" style="margin-top:2px">${esc(b.brew_method || '')}</div>
          </div>
        </div>
      </div>
    </button>`;
  }

  results.addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (b) location.hash = b.dataset.go;
  });

  view.querySelectorAll('[data-new], [data-new2]').forEach(b => {
    b.onclick = () => { location.hash = '#/new'; };
  });

  paint();
  root.appendChild(view);
}
