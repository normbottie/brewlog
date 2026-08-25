/* Local-first domain store.
   IndexedDB is the source of truth on device; Supabase is an optional
   sync target. Everything works fully offline with no Supabase config. */

import { idb, metaGet, metaSet, getBlob, putBlob, delBlob } from './idb.js';
import * as sb from './supabase.js';
import { accessToken, isSignedIn, userId, onAuthChange } from './auth.js';
import { getImageAPIConfig, setImageAPIConfig } from './imaging.js';

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

/* A café you mean to try, rather than one you've been to. Derived rather
   than stored in its own column: "no visit date and no rating" already
   means exactly this, and inventing a column would break syncing for any
   project that hasn't run the newest schema.sql. Rating it, or dating a
   visit, graduates it off the list on its own. */
export const isWishlist = (c) => !!c && !c.visited_on && !Number(c.rating);

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

async function allLive(store, { shared = false } = {}) {
  const rows = await idb.all(store);
  const me = userId();
  return rows
    .filter(r => !r.deleted)
    .filter(r => (shared ? true : (!r.user_id || r.user_id === me)))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

export const listBeans = (opts) => allLive('beans', opts);
export const listCafes = (opts) => allLive('cafes', opts);

/* Which entries the list screens are currently showing. The detail screen
   needs the same answer so that paging through beans walks the list you
   were actually looking at. */
export const SCOPE_KEYS = { beans: 'brewlog.scope.beans', cafes: 'brewlog.scope.cafes' };
export function scopeShared(kind) {
  try { return localStorage.getItem(SCOPE_KEYS[kind]) === '1'; } catch { return false; }
}

/** The entries either side of `id`, in list order, wrapping at both ends. */
export async function beanNeighbours(id) {
  const list = await listBeans({ shared: scopeShared('beans') });
  const i = list.findIndex(b => b.id === id);
  if (i < 0 || list.length < 2) return { prev: null, next: null, index: i, total: list.length };
  return {
    prev: list[(i - 1 + list.length) % list.length],
    next: list[(i + 1) % list.length],
    index: i,
    total: list.length,
  };
}
export const getBean = (id) => idb.get('beans', id);
export const getCafe = (id) => idb.get('cafes', id);

/* ---- write --------------------------------------------------------- */

async function save(store, rec) {
  if (!canEdit(rec)) throw new Error('This entry belongs to another member');
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

/* Which image_url the cached blob was fetched from. A bean's storage path
   never changes when you re-shoot it, so without this the first download
   is cached forever and other devices keep showing the old photo. */
const imgSrcKey = (beanId) => `imgsrc:${beanId}`;

const urlCache = new Map();   // id -> { url, src }

function releaseURL(beanId) {
  const c = urlCache.get(beanId);
  if (c) { URL.revokeObjectURL(c.url); urlCache.delete(beanId); }
}

export async function setBeanImage(beanId, blob, rawBlob) {
  await putBlob(imgKey(beanId), blob);
  if (rawBlob) await putBlob(rawKey(beanId), rawBlob);
  releaseURL(beanId);
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
  const src = bean.image_url || '';

  const cached = urlCache.get(bean.id);
  if (cached && cached.src === src) return cached.url;
  releaseURL(bean.id);

  let blob = await getBlob(imgKey(bean.id));
  /* A local blob that hasn't been pushed yet is always the freshest thing
     we have. Otherwise it's only good if it came from the current URL. */
  if (blob && src && !bean._imgDirty) {
    const from = await metaGet(imgSrcKey(bean.id), null);
    if (from !== src) blob = null;
  }

  if (!blob && src) {
    try {
      blob = await sb.downloadImage(src);
      await putBlob(imgKey(bean.id), blob);
      await metaSet(imgSrcKey(bean.id), src);
    } catch { return src; }
  }
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(bean.id, { url, src });
  return url;
}

/* ---- importing someone else's bag ---------------------------------- */

/* What's printed on the bag comes across; what somebody thought of it does
   not. Ratings, overall, notes, grind and brew method start blank — the
   whole point is to record your own findings on the same coffee. Roast date
   is left out too: their bag is not your bag. */
const BAG_FIELDS = [
  'name', 'roaster', 'origin', 'region', 'process', 'varietal',
  'roast_level', 'weight_g', 'price',
];

/** An entry of yours that looks like the same coffee, or null. */
export async function myBeanLike(src) {
  const norm = (s) => String(s ?? '').trim().toLowerCase();
  if (!norm(src?.name)) return null;
  const mine = await listBeans({ shared: false });
  return mine.find(b =>
    norm(b.name) === norm(src.name) && norm(b.roaster) === norm(src.roaster)) || null;
}

/**
 * Copy a shared bag into your own log, ready for your own tasting notes.
 * @returns {Promise<object>} the new bean, already saved
 */
export async function importBean(sourceId) {
  const src = await getBean(sourceId);
  if (!src || src.deleted) throw new Error('That entry is no longer available');
  if (!isForeign(src)) throw new Error('That entry is already yours');

  const mine = blankBean();
  BAG_FIELDS.forEach(f => { if (src[f]) mine[f] = src[f]; });
  // the roaster's printed notes describe the bag, they aren't a verdict on it
  mine.flavor_notes = Array.isArray(src.flavor_notes) ? [...src.flavor_notes] : [];
  await save('beans', mine);

  /* Take a copy of the photo rather than pointing at theirs, so your entry
     keeps working if they re-shoot the bag or stop sharing. */
  try {
    const blob = (await getBlob(imgKey(src.id)))
      || (src.image_url ? await sb.downloadImage(src.image_url) : null);
    if (blob) await setBeanImage(mine.id, blob);
  } catch { /* the photo is a nicety — the entry stands without it */ }

  return mine;
}

/* ---- members & sharing --------------------------------------------- */

/* Rows owned by someone else arrive through sync when that member has opted
   into sharing. They are marked _foreign: never pushed, never editable. */
export const isForeign = (rec) => !!rec && rec.user_id && rec.user_id !== userId();

let profileCache = [];   // [{ user_id, display_name, share_log, _slot }]

export function membersById() {
  const m = new Map();
  profileCache.forEach(p => m.set(p.user_id, p));
  return m;
}

export function sharingMembers() {
  return profileCache.filter(p => p.share_log && p.user_id !== userId());
}

/* ---- admins and approval ------------------------------------------- */

/* These flags live in columns added by a later schema.sql. If the project
   hasn't run it, no profile carries them — and the safe reading of that is
   "nobody is an admin, and approval isn't gating anything", rather than
   locking every member out of their own log. */
export function approvalEnabled() {
  return profileCache.some(p => Object.prototype.hasOwnProperty.call(p, 'approved'));
}

export function isAdmin() { return !!myProfile()?.is_admin; }

export function isApproved() {
  if (!approvalEnabled()) return true;
  const p = myProfile();
  return !!(p?.approved || p?.is_admin);
}

/** Everyone with a profile, admins first, then pending, then by name. */
export function allMembers() {
  const rank = (p) => (p.is_admin ? 0 : p.approved ? 2 : 1);
  return [...profileCache].sort((a, b) =>
    rank(a) - rank(b) ||
    String(a.display_name || '').localeCompare(String(b.display_name || '')));
}

export function pendingMembers() {
  if (!approvalEnabled()) return [];
  return profileCache.filter(p => !p.approved && !p.is_admin);
}

/** Admins may let a member in, or put them back out. */
export async function setMemberApproval(memberId, approved) {
  if (!isAdmin()) throw new Error('Only an admin can do that');
  if (memberId === userId()) throw new Error('You cannot change your own access');
  /* A PATCH, not an upsert: upserting someone else's row has to satisfy the
     insert policy too, and that one is rightly "your own row only". */
  await sb.patch('profiles', `user_id=eq.${encodeURIComponent(memberId)}`,
    { approved: !!approved, updated_at: now() });
  await pullProfiles();
  document.dispatchEvent(new CustomEvent('brewlog:data'));
}

/** Whether this account may change `rec` — its owner, or an admin. */
export function canEdit(rec) { return !isForeign(rec) || isAdmin(); }

export function myProfile() {
  return profileCache.find(p => p.user_id === userId()) || null;
}

/** Colour slots are assigned by a stable order so a member keeps their hue. */
function assignSlots(rows) {
  const others = rows
    .filter(p => p.user_id !== userId())
    .sort((a, b) => String(a.created_at || a.user_id).localeCompare(String(b.created_at || b.user_id)));
  others.forEach((p, i) => { p._slot = i; });
  rows.filter(p => p.user_id === userId()).forEach(p => { p._slot = -1; });
  return rows;
}

let profilesFresh = false;   // have we read profiles from the server this session?

async function pullProfiles() {
  try {
    const rows = await sb.selectSince('profiles', null);
    profileCache = assignSlots(rows || []);
    profilesFresh = true;
    await metaSet('profiles', profileCache);
  } catch { /* table may predate this feature */ }
}

/* ---- onboarding ---------------------------------------------------- */

/* A new account has no profile row, so it has no name to put on shared
   entries and has never been asked whether it wants to share at all.
   Answered once and remembered, so a later blank name doesn't re-prompt. */
let onboardingDone = false;

export async function needsOnboarding() {
  if (onboardingDone || !isSignedIn()) return false;
  if (await metaGet('onboarded', false)) { onboardingDone = true; return false; }

  // Don't guess from an empty cache on a fresh device — ask the server first.
  if (!profilesFresh) await pullProfiles();
  if (!profilesFresh) return false;   // offline: never block on a form that can't submit

  if ((myProfile()?.display_name || '').trim()) {
    await finishOnboarding();
    return false;
  }
  return true;
}

export async function finishOnboarding() {
  onboardingDone = true;
  await metaSet('onboarded', true);
}

export async function loadCachedProfiles() {
  const cached = await metaGet('profiles', null);
  if (cached) profileCache = cached;
  return profileCache;
}

/** Update my own profile row (display name / sharing opt-in). */
export async function saveMyProfile({ display_name, share_log }) {
  const me = userId();   // don't shadow the exported uid() generator
  if (!me) throw new Error('Sign in first');
  const row = {
    user_id: me,
    ...(display_name !== undefined ? { display_name } : {}),
    ...(share_log !== undefined ? { share_log } : {}),
    updated_at: now(),
  };
  await sb.upsert('profiles', [row]);
  await pullProfiles();
  document.dispatchEvent(new CustomEvent('brewlog:data'));
  return row;
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
  /* Keep whoever owns it. Stamping `owner` unconditionally would have an
     admin's correction quietly transfer the entry into their own log —
     and RLS would reject it anyway, since the row already belongs to
     someone else. New local rows have no owner yet, so they get one. */
  out.user_id = rec.user_id || owner;
  return out;
}

/* App settings (currently the image-API key) sync through the account so a
   second device gets them after sign-in instead of asking again. */
const LS_SETTINGS_DIRTY = 'brewlog.settings.dirty';

export function markSettingsDirty() {
  try { localStorage.setItem(LS_SETTINGS_DIRTY, '1'); } catch {}
  queueSync(400);
}

async function syncSettings(owner) {
  try {
    let dirty = false;
    try { dirty = localStorage.getItem(LS_SETTINGS_DIRTY) === '1'; } catch {}
    const local = getImageAPIConfig();

    if (dirty) {
      await sb.upsert('settings', [{
        user_id: owner,
        data: { img: local },        // null when the key was removed
        updated_at: new Date().toISOString(),
      }]);
      try { localStorage.removeItem(LS_SETTINGS_DIRTY); } catch {}
      return;
    }

    if (!local) {
      const rows = await sb.selectSince('settings', null);
      const img = rows?.[0]?.data?.img;
      if (img?.key) {
        setImageAPIConfig(img.provider, img.key, img.model);
        document.dispatchEvent(new CustomEvent('brewlog:data'));
      }
    }
  } catch { /* settings table may not exist yet — harmless */ }
}

/** Drop locally-cached rows belonging to members who no longer share. */
async function purgeUnshared(table) {
  const me = userId();
  if (!me) return;   // without an identity every row looks foreign — never guess
  const sharers = new Set(profileCache.filter(p => p.share_log).map(p => p.user_id));
  const rows = await idb.all(table);
  for (const r of rows) {
    if (r.user_id && r.user_id !== me && !sharers.has(r.user_id)) {
      await idb.del(table, r.id);
    }
  }
}

let syncTimer = null;
let syncing = false;
let lastSyncAt = 0;

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
    /* Profiles first: who is sharing decides what the row pull can even
       see, so a stale roster makes the pull below fetch the wrong set. */
    await pullProfiles();

    /* When someone turns sharing on, their existing rows become visible to
       us but their updated_at is older than our pull watermark — an
       incremental fetch would never ask for them, which is why shared
       entries only appeared after a fresh sign-in. Start over when the
       roster changes. */
    const roster = profileCache
      .filter(p => p.share_log && p.user_id !== owner)
      .map(p => p.user_id).sort().join(',');
    const rosterChanged = (await metaGet('sync:roster', null)) !== roster;
    if (rosterChanged) {
      await metaSet('sync:beans', null);
      await metaSet('sync:cafes', null);
      await metaSet('sync:roster', roster);
    }

    for (const table of ['beans', 'cafes']) {
      /* --- push --- */
      const local = await idb.all(table);
      // admins edit other members' entries, so those have to push too
      const dirty = local.filter(r => r._dirty && canEdit(r));

      if (table === 'beans') {
        for (const b of dirty.filter(r => r._imgDirty)) {
          const blob = await getBlob(imgKey(b.id));
          if (!blob) { delete b._imgDirty; continue; }
          try {
            const base = await sb.uploadImage(`${owner}/${b.id}.jpg`, blob);
            /* The path is stable across re-shoots, so stamp a version onto
               the URL: it busts the storage CDN and gives other devices a
               way to tell that the photo behind it changed. */
            b.image_url = `${base}?v=${Date.now().toString(36)}`;
            await metaSet(imgSrcKey(b.id), b.image_url);
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
          // never let a pull overwrite an edit that hasn't been pushed yet
          if (mine?._dirty) continue;
          if (!mine || (r.updated_at || '') > (mine.updated_at || '')) merged.push(r);
        }
        if (merged.length) await idb.putAll(table, merged);
        if (watermark) await metaSet(`sync:${table}`, watermark);
      }

      /* RLS simply stops returning the rows of a member who switched
         sharing off; the copies already on this device have to go too. */
      if (rosterChanged) await purgeUnshared(table);
    }
    await syncSettings(owner);
    lastSyncAt = Date.now();
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

/* An installed PWA is frozen, not closed, so without this nothing pulls
   between launches — which is why signing out and back in looked like the
   only way to see another device's changes. */
function syncOnResume() {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastSyncAt < 15000) return;
  queueSync(300);
}
document.addEventListener('visibilitychange', syncOnResume);
window.addEventListener('pageshow', syncOnResume);
window.addEventListener('focus', syncOnResume);

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
