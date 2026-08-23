/* Router + shell. */

import { icon, toast } from './ui.js';
import { queueSync, onSyncChange, syncState } from './store.js';
import { captureSession } from './auth.js';

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

function looksLikeAuthCallback() {
  const hash = location.hash.slice(1);
  return /(^|&)(access_token|error_description|error)=/.test(hash);
}

async function route() {
  /* Also handle the callback here, not just on load: if the app is already
     open when the hash changes, the initial captureSession() has long since
     run and the tokens would otherwise be routed as an unknown page. */
  if (looksLikeAuthCallback()) {
    try {
      if (await captureSession()) toast('Signed in');
    } catch (err) {
      toast(err.message || 'Sign-in failed', 6000);
    }
  }

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

/* ---- pull to refresh ----------------------------------------------
   The installed app has no browser chrome, so there is no reload button.
   Pull down from the top of any page to refresh (which also syncs). */
(function () {
  const ptr = document.createElement('div');
  ptr.id = 'ptr';
  ptr.setAttribute('aria-hidden', 'true');
  ptr.innerHTML = '<div class="disc"><span class="spinner"></span></div>';
  document.body.appendChild(ptr);

  const ARM = 150;        // raw finger travel, px
  let y0 = -1;
  let dist = 0;

  document.addEventListener('touchstart', (e) => {
    dist = 0;
    const t = e.target;
    // never fight the map, sheets, sliders, or a scrolled page
    const excluded = typeof t.closest === 'function' &&
      t.closest('#map, .leaflet-container, .sheet-backdrop, input[type="range"], textarea');
    y0 = (window.scrollY <= 0 && !excluded) ? e.touches[0].clientY : -1;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (y0 < 0) return;
    dist = e.touches[0].clientY - y0;
    if (dist <= 12 || window.scrollY > 0) {
      ptr.classList.remove('show', 'armed');
      return;
    }
    const d = Math.min(dist, ARM * 1.35);
    ptr.style.setProperty('--pull', (d * 0.5).toFixed(1) + 'px');
    ptr.classList.add('show');
    ptr.classList.toggle('armed', dist > ARM);
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (y0 >= 0 && dist > ARM) {
      ptr.classList.add('loading');
      setTimeout(() => location.reload(), 180);
    } else {
      ptr.classList.remove('show', 'armed');
    }
    y0 = -1;
    dist = 0;
  });
})();

/* A magic-link redirect lands with the session in the URL fragment, which is
   also where the router looks — so consume it before routing. */
captureSession()
  .then(ok => { if (ok) toast('Signed in'); })
  .catch(err => { toast(err.message || 'Sign-in failed', 6000); })
  .finally(() => {
    route();
    queueSync(1200);
  });
