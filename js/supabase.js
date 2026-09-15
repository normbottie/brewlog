/* Thin Supabase REST + Storage client (no SDK, no build step).
   Configured at runtime from Settings; credentials live in localStorage. */

import { DEFAULT_SUPABASE } from './config.js';

const LS_URL = 'brewlog.supabase.url';
const LS_KEY = 'brewlog.supabase.key';

export const BUCKET = 'bag-images';

export function getConfig() {
  let url = '', key = '';
  try {
    url = (localStorage.getItem(LS_URL) || '').trim().replace(/\/+$/, '');
    key = (localStorage.getItem(LS_KEY) || '').trim();
  } catch {}
  // fall back to the baked-in project so new devices need no setup
  url = url || DEFAULT_SUPABASE.url;
  key = key || DEFAULT_SUPABASE.key;
  return url && key ? { url, key } : null;
}

/** Accepts the real API URL, or a pasted dashboard URL, or just the ref. */
export function normalizeProjectURL(url) {
  let u = (url || '').trim().replace(/\/+$/, '');
  // https://supabase.com/dashboard/project/<ref>/... -> https://<ref>.supabase.co
  const dash = /supabase\.(?:com|green)\/dashboard\/project\/([a-z0-9]{15,25})/i.exec(u);
  if (dash) return `https://${dash[1].toLowerCase()}.supabase.co`;
  // a bare project ref
  if (/^[a-z0-9]{15,25}$/i.test(u)) return `https://${u.toLowerCase()}.supabase.co`;
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

export function setConfig(url, key) {
  try {
    localStorage.setItem(LS_URL, normalizeProjectURL(url));
    localStorage.setItem(LS_KEY, (key || '').trim());
  } catch { /* private mode */ }
}

export function clearConfig() {
  try { localStorage.removeItem(LS_URL); localStorage.removeItem(LS_KEY); } catch {}
}

export function isConfigured() { return !!getConfig(); }

/* Requests are made as the signed-in user when there is one, so row-level
   security scopes every read and write to that account. Falls back to the
   anon key, which the policies then reject — that is the intended behaviour
   once auth is on. */
let tokenProvider = async () => null;
export function setTokenProvider(fn) { tokenProvider = fn; }

async function headers(cfg, extra = {}) {
  let token = null;
  try { token = await tokenProvider(); } catch {}
  return {
    apikey: cfg.key,
    Authorization: `Bearer ${token || cfg.key}`,
    ...extra,
  };
}

/* Errors thrown from here carry `.status`, so a caller can tell "the server
   refused this row" (4xx, retrying won't help) from "the connection died"
   (no status, retrying will). */
function httpError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

async function jsonOrThrow(res) {
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch {}
    const detail = body?.message || '';
    /* PGRST205: the table isn't in PostgREST's schema cache — either it was
       never created or the cache is still catching up. Say what to do
       instead of surfacing the raw code. */
    const missing = /Could not find the table '([^']+)'/.exec(detail);
    if (body?.code === 'PGRST205' || missing) {
      const table = (missing?.[1] || '').replace(/^public\./, '') || 'a table';
      throw httpError(
        `Your database is missing the \`${table}\` table — run the latest schema.sql ` +
        `in the Supabase SQL editor (Settings → SQL Editor → New query). ` +
        `If you just ran it, wait ~30 seconds and try again.`,
        res.status, body?.code
      );
    }
    if (res.status === 401) {
      throw httpError('Supabase rejected your sign-in — sign out and back in.', 401, body?.code);
    }
    if (res.status === 403) {
      /* Authenticated fine; the database refused. 42501 is row-level security,
         which is a permissions problem and has nothing to do with sign-in —
         saying "check you are signed in" here sends you hunting in the wrong
         place, which cost three weeks once. */
      const code = body?.code ? ` (${body.code})` : '';
      throw httpError(
        body?.message
          ? `The database refused that${code}: ${body.message}`
          : 'The database refused that request — you may not have permission.',
        403, body?.code
      );
    }
    throw httpError(detail || `Supabase error ${res.status}`, res.status, body?.code);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** GET rows from `table` changed at or after `since` (ISO string). */
export async function selectSince(table, since) {
  const cfg = getConfig();
  if (!cfg) return [];
  const q = new URLSearchParams({ select: '*', order: 'updated_at.asc' });
  if (since) q.set('updated_at', `gte.${since}`);
  const res = await fetch(`${cfg.url}/rest/v1/${table}?${q}`, { headers: await headers(cfg) });
  return (await jsonOrThrow(res)) || [];
}

/** Upsert rows into `table`. */
export async function upsert(table, rows) {
  const cfg = getConfig();
  if (!cfg || !rows.length) return null;
  const res = await fetch(`${cfg.url}/rest/v1/${table}`, {
    method: 'POST',
    headers: await headers(cfg, {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify(rows),
  });
  return jsonOrThrow(res);
}

/** PATCH rows matching a PostgREST filter, e.g. `user_id=eq.<uuid>`. */
export async function patch(table, query, body) {
  const cfg = getConfig();
  if (!cfg) return null;
  const res = await fetch(`${cfg.url}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: await headers(cfg, {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    }),
    body: JSON.stringify(body),
  });
  return jsonOrThrow(res);
}

/** Upload a blob to storage; returns the bucket-relative path it landed on.
 *
 * A path, not a URL, on purpose: the bucket is private, so a stored link
 * would be a signed one — and a signed link expires, which makes it exactly
 * the wrong thing to write into a database row that syncs to other devices.
 * Rows carry the path; a fresh signature is minted at the moment of reading.
 */
export async function uploadImage(path, blob) {
  const cfg = getConfig();
  if (!cfg) return null;
  const res = await fetch(
    `${cfg.url}/storage/v1/object/${BUCKET}/${encodeURI(path)}`,
    {
      method: 'POST',
      headers: await headers(cfg, {
        'Content-Type': blob.type || 'image/jpeg',
        'x-upsert': 'true',
      }),
      body: blob,
    }
  );
  if (!res.ok && res.status !== 409) await jsonOrThrow(res);
  return path;
}

/**
 * The bucket-relative path inside whatever a row is carrying.
 *
 * Rows written before the bucket went private hold a full public URL, and
 * they must keep working without a migration, so accept either shape. The
 * `?v=` cache-buster that store.js stamps on is dropped — it is ours, not
 * storage's, and signing a path that has one 404s.
 */
export function storagePath(src) {
  let s = String(src || '').split('?')[0].split('#')[0];
  if (!s) return '';
  const marker = new RegExp(`/storage/v1/object/(?:public/|sign/|authenticated/)?${BUCKET}/`);
  const m = marker.exec(s);
  if (m) s = s.slice(m.index + m[0].length);
  else if (/^https?:\/\//i.test(s)) return '';   // some other host's image
  else s = s.replace(new RegExp(`^/?${BUCKET}/`), '').replace(/^\/+/, '');
  try { s = decodeURIComponent(s); } catch {}
  return s;
}

/** A short-lived signed URL for a private object. */
export async function signedImageURL(path, expiresIn = 300) {
  const cfg = getConfig();
  if (!cfg || !path) return null;
  const res = await fetch(
    `${cfg.url}/storage/v1/object/sign/${BUCKET}/${encodeURI(path)}`,
    {
      method: 'POST',
      headers: await headers(cfg, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn }),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `Could not sign that image (${res.status})`);
  }
  const body = await res.json();
  // the API has spelled this both ways across versions
  const rel = body?.signedURL || body?.signedUrl || '';
  if (!rel) throw new Error('Storage returned no signed URL');
  return /^https?:\/\//i.test(rel)
    ? rel
    : `${cfg.url}/storage/v1/${rel.replace(/^\/+/, '')}`;
}

/**
 * Fetch a bag or brew photo. `src` is whatever the row holds: a path (new),
 * or a full public URL (old rows, and any project whose bucket is still
 * public because the latest schema.sql hasn't been applied yet). Signing is
 * tried first; a public URL that is still public is the fallback, which is
 * what keeps the app working either side of that deploy.
 */
export async function downloadImage(src) {
  const path = storagePath(src);
  if (path) {
    try {
      const url = await signedImageURL(path);
      const res = await fetch(url);
      if (res.ok) return res.blob();
      if (!/^https?:\/\//i.test(String(src))) {
        throw new Error(`Image download failed (${res.status})`);
      }
    } catch (err) {
      if (!/^https?:\/\//i.test(String(src))) throw err;
    }
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Image download failed (${res.status})`);
  return res.blob();
}

/** Reachability + schema check used by the Settings screen. */
export async function testConnection() {
  const cfg = getConfig();
  if (!cfg) throw new Error('Not configured');

  let res;
  try {
    res = await fetch(`${cfg.url}/rest/v1/beans?select=id&limit=1`, { headers: await headers(cfg) });
  } catch {
    throw new Error('Could not reach that project — check the URL and your connection');
  }

  if (res.ok) return true;

  let body = null;
  try { body = await res.json(); } catch {}
  const code = body?.code || '';
  const msg = body?.message || '';

  if (res.status === 401 || res.status === 403) {
    throw new Error('The project answered but rejected the key — check you copied the anon or publishable key, not a secret one');
  }
  // PGRST205: the table is not in PostgREST's schema cache. Either it was
  // never created, or it was created seconds ago and the cache is stale.
  if (res.status === 404 || code === 'PGRST205' || code === '42P01') {
    throw new Error(
      'Reached the project, but it has no `beans` table. Run schema.sql in the SQL editor — ' +
      'and check the Results pane for a red error, since the editor runs the whole script as ' +
      'one transaction and rolls everything back if any line fails. If you just ran it, wait ' +
      '30 seconds and try again.'
    );
  }
  throw new Error(msg || `Supabase error ${res.status}`);
}
