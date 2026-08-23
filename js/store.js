/* Local-first domain store.
   IndexedDB is the source of truth on device; Supabase is an optional
   sync target. Everything works fully offline with no Supabase config. */

import { idb, metaGet, metaSet, getBlob, putBlob, delBlob } from './idb.js';
import * as sb from './supabase.js';
import { accessToken, isSignedIn, userId, onAuthChange } from './auth.js';

// every Supabase request goes out as the signed-in user
sb.setTokenProvider(accessToken);

export const AXES = ['aromatics', 'acidity', 'sweetness', 'aftertaste', 'body'];
export const AXIS_LABELS = {
  aromatics: 'Aromatics',
  acidity: 'Acidity',
  sweetness: 'Sweetness',
  aftertaste: 'Aftertaste',
  body: 'Body',
};

export const BREW_METHODS = [
  'Espresso', 'Latte', 'Cappuccino', 'Cortado', 'Flat White',
  'Drip', 'Pour Over', 'V60', 'Chemex', 'AeroPress',
  'French Press', 'Moka Pot', 'Cold Brew', 'Iced',
];

export const ROAST_LEVELS = ['Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'];
export const PROCESSES = ['Washed', 'Natural', 'Honey', 'Anaerobic', 'Wet-Hulled', 'Carbonic Maceration', 'Other'];

/* ------------------------------------------------------------------ */

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const now = () => new Date().toISOString();

export function blankBean() {
  return {
    id: uid(),
    name: '',
    roaster: '',
    origin: '',
    region: '',
    process: '',
    varietal: '',
    roast_level: '',
    roast_date: '',
    price: '',
    weight_g: '',
    brew_method: 'Espresso',
    grind: '',
    flavor_notes: [],
    ratings: { aromatics: 3, acidity: 3, sweetness: 3, aftertaste: 3, body: 3 },
    overall: 0,
    notes: '',
    image_url: '',
    created_at: now(),
    updated_at: now(),
    deleted: false,
  };
}

export function blankCafe() {
  return {
    id: uid(),
    name: '',
    address: '',
    lat: null,
    lng: null,
    rating: 0,
    notes: '',
    visited_on: new Date().toISOString().slice(0, 10),
    created_at: now(),
    updated_at: now(),
    deleted: false,
  };
}

/* ---- read ---------------------------------------------------------- */

async function allLive(store) {
  const rows = await idb.all(store);
  return rows
    .filter(r => !r.deleted)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

export const listBeans = () => allLive('beans');
export const listCafes = () => allLive('cafes');
export const getBean = (id) => idb.get('beans', id);
export const getCafe = (id) => idb.get('cafes', id);

/* ---- write --------------------------------------------------------- */

async function save(store, rec) {
  rec.updated_at = now();
  rec._dirty = true;
  await idb.put(store, rec);
  queueSync();
  return rec;
}

export const saveBean = (b) => save('beans', b);
export const saveCafe = (c) => save('cafes', c);

export async function removeBean(id) {
  const b = await getBean(id);
  if (!b) return;
  b.deleted = true;
  await save('beans', b);
  await delBlob(imgKey(id));
}

export async function removeCafe(id) {
  const c = await getCafe(id);
  if (!c) return;
  c.deleted = true;
  await save('cafes', c);
}

/* ---- images -------------------------------------------------------- */

export const imgKey = (beanId) => `bean:${beanId}:studio`;
export const rawKey = (beanId) => `bean:${beanId}:raw`;

const urlCache = new Map();

export async function setBeanImage(beanId, blob, rawBlob) {
  await putBlob(imgKey(beanId), blob);
  if (rawBlob) await putBlob(rawKey(beanId), rawBlob);
  const old = urlCache.get(beanId);
  if (old) { URL.revokeObjectURL(old); urlCache.delete(beanId); }
  const bean = await getBean(beanId);
  if (bean) { bean._imgDirty = true; await save('beans', bean); }
}

/** The original camera photo, kept so the framing can be redone later. */
export function beanRawBlob(beanId) {
  return getBlob(rawKey(beanId));
}

/** Object URL for a bean's studio shot, pulling from Supabase if needed. */
export async function beanImageURL(bean) {
  if (!bean) return null;
  if (urlCache.has(bean.id)) return urlCache.get(bean.id);
  let blob = await getBlob(imgKey(bean.id));
  if (!blob && bean.image_url) {
    try {
      blob = await sb.downloadImage(bean.image_url);
      await putBlob(imgKey(bean.id), blob);
    } catch { return bean.image_url; }
  }
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(bean.id, url);
  return url;
}

/* ---- sync ---------------------------------------------------------- */

const listeners = new Set();
export function onSyncChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export let syncState = { status: 'off', message: 'Local only', at: null };

function setState(status, message) {
  syncState = { status, message, at: Date.now() };
  listeners.forEach(fn => { try { fn(syncState); } catch {} });
}

const LOCAL_FIELDS = ['_dirty', '_imgDirty'];
function toRemote(rec, owner) {
  const out = { ...rec };
  LOCAL_FIELDS.forEach(f => delete out[f]);
  out.user_id = owner;    // row-level security matches this against auth.uid()
  return out;
}

let syncTimer = null;
let syncing = false;

export function queueSync(delay = 1500) {
  if (!sb.isConfigured()) { setState('off', 'Local only'); return; }
  if (!isSignedIn()) { setState('off', 'Sign in to sync'); return; }
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { sync().catch(() => {}); }, delay);
}

export async function sync() {
  if (!sb.isConfigured()) { setState('off', 'Local only'); return false; }
  if (!isSignedIn()) { setState('off', 'Sign in to sync'); return false; }
  if (syncing) return false;
  if (!navigator.onLine) { setState('err', 'Offline — will retry'); return false; }
  syncing = true;
  setState('busy', 'Syncing…');
  const owner = userId();
  try {
    for (const table of ['beans', 'cafes']) {
      /* --- push --- */
      const local = await idb.all(table);
      const dirty = local.filter(r => r._dirty);

      if (table === 'beans') {
        for (const b of dirty.filter(r => r._imgDirty)) {
          const blob = await getBlob(imgKey(b.id));
          if (!blob) { delete b._imgDirty; continue; }
          try {
            b.image_url = await sb.uploadImage(`${owner}/${b.id}.jpg`, blob);
            delete b._imgDirty;
          } catch { /* retry next round */ }
        }
      }

      if (dirty.length) {
        await sb.upsert(table, dirty.map(r => toRemote(r, owner)));
        for (const r of dirty) { delete r._dirty; await idb.put(table, r); }
      }

      /* --- pull --- */
      const since = await metaGet(`sync:${table}`, null);
      const remote = await sb.selectSince(table, since);
      if (remote.length) {
        const byId = new Map(local.map(r => [r.id, r]));
        const merged = [];
        let watermark = since;
        for (const r of remote) {
          if (!watermark || (r.updated_at || '') > watermark) watermark = r.updated_at;
          const mine = byId.get(r.id);
          if (!mine || (r.updated_at || '') > (mine.updated_at || '')) merged.push(r);
        }
        if (merged.length) await idb.putAll(table, merged);
        if (watermark) await metaSet(`sync:${table}`, watermark);
      }
    }
    setState('on', 'Synced');
    document.dispatchEvent(new CustomEvent('brewlog:data'));
    return true;
  } catch (err) {
    setState('err', err.message || 'Sync failed');
    return false;
  } finally {
    syncing = false;
  }
}

window.addEventListener('online', () => queueSync(500));

onAuthChange(async (s) => {
  const previous = await metaGet('sync:owner', null);
  const current = s?.user?.id || null;
  if (current && previous && current !== previous) {
    // switching accounts: forget the pull watermarks so the new account
    // fetches its own rows from scratch
    await metaSet('sync:beans', null);
    await metaSet('sync:cafes', null);
  }
  if (current) { await metaSet('sync:owner', current); queueSync(400); }
  else setState('off', 'Sign in to sync');
});

/* ---- export / import ---------------------------------------------- */

export async function exportJSON() {
  const beans = await idb.all('beans');
  const cafes = await idb.all('cafes');
  return JSON.stringify({ app: 'brewlog', version: 1, exported_at: now(), beans, cafes }, null, 2);
}

export async function importJSON(text) {
  const data = JSON.parse(text);
  if (!data || data.app !== 'brewlog') throw new Error('Not a Brewlog export file');
  let n = 0;
  for (const table of ['beans', 'cafes']) {
    const rows = (data[table] || []).map(r => ({ ...r, _dirty: true }));
    if (rows.length) { await idb.putAll(table, rows); n += rows.length; }
  }
  queueSync(300);
  return n;
}
