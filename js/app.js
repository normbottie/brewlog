/* Router + shell. */

import { icon } from './ui.js';
import { queueSync, onSyncChange, syncState } from './store.js';

import * as Beans from './views/beans.js';
import * as BeanDetail from './views/bean-detail.js';
import * as BeanEdit from './views/bean-edit.js';
import * as Cafes from './views/cafes.js';
import * as CafeDetail from './views/cafe-detail.js';
import * as Settings from './views/settings.js';

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');

const TABS = [
  { id: 'beans', label: 'Beans', route: '#/beans', icon: 'bean' },
  { id: 'cafes', label: 'Cafes', route: '#/cafes', icon: 'map' },
  { id: 'settings', label: 'Settings', route: '#/settings', icon: 'gear' },
];

function renderTabs(active) {
  tabbar.innerHTML = TABS.map(t => `
    <button data-route="${t.route}" class="${t.id === active ? 'active' : ''}"
            aria-current="${t.id === active ? 'page' : 'false'}">
      ${icon(t.icon)}<span>${t.label}</span>
    </button>`).join('');
}

tabbar.addEventListener('click', e => {
  const b = e.target.closest('[data-route]');
  if (b) location.hash = b.dataset.route;
});

/* ------------------------------------------------------------------ */

const ROUTES = [
  [/^#\/beans\/?$/, () => ({ view: Beans, args: [], tab: 'beans' })],
  [/^#\/bean\/([^/]+)\/edit$/, m => ({ view: BeanEdit, args: [m[1]], tab: 'beans' })],
  [/^#\/bean\/([^/]+)$/, m => ({ view: BeanDetail, args: [m[1]], tab: 'beans' })],
  [/^#\/new\/?$/, () => ({ view: BeanEdit, args: [null], tab: 'beans' })],
  [/^#\/cafes\/?$/, () => ({ view: Cafes, args: [], tab: 'cafes' })],
  [/^#\/cafe\/([^/]+)$/, m => ({ view: CafeDetail, args: [m[1]], tab: 'cafes' })],
  [/^#\/settings\/?$/, () => ({ view: Settings, args: [], tab: 'settings' })],
];

let current = null;

async function route() {
  const hash = location.hash || '#/beans';
  let match = null;
  for (const [re, fn] of ROUTES) {
    const m = re.exec(hash);
    if (m) { match = fn(m); break; }
  }
  if (!match) { location.replace('#/beans'); return; }

  if (current && current.destroy) { try { current.destroy(); } catch {} }
  current = null;

  renderTabs(match.tab);
  app.innerHTML = '';
  window.scrollTo(0, 0);

  try {
    const result = await match.view.render(app, ...match.args);
    current = result || null;
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="view"><div class="empty glass card-pad">
      <h3>Something went wrong</h3><p>${String(err.message || err)}</p></div></div>`;
  }
}

window.addEventListener('hashchange', route);
document.addEventListener('brewlog:navigate', e => { location.hash = e.detail; });
document.addEventListener('brewlog:data', () => {
  // re-render list views when a sync brings in new rows
  if (/^#\/(beans|cafes)\/?$/.test(location.hash || '#/beans')) route();
});

/* sync status pill in the top bar of whichever view draws one */
onSyncChange(() => {
  document.querySelectorAll('[data-sync-dot]').forEach(el => {
    el.className = `sync-dot ${syncState.status === 'on' ? 'on' : syncState.status === 'err' ? 'err' : ''}`;
    el.title = syncState.message;
  });
  document.querySelectorAll('[data-sync-msg]').forEach(el => { el.textContent = syncState.message; });
});

/* ------------------------------------------------------------------ */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

route();
queueSync(1200);
