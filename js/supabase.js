/* Thin Supabase REST + Storage client (no SDK, no build step).
   Configured at runtime from Settings; credentials live in localStorage. */

const LS_URL = 'brewlog.supabase.url';
const LS_KEY = 'brewlog.supabase.key';

export const BUCKET = 'bag-images';

export function getConfig() {
  try {
    const url = (localStorage.getItem(LS_URL) || '').trim().replace(/\/+$/, '');
    const key = (localStorage.getItem(LS_KEY) || '').trim();
    return url && key ? { url, key } : null;
  } catch { return null; }
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

async function jsonOrThrow(res) {
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch {}
    throw new Error(`Supabase ${res.status}${detail ? ': ' + detail : ''}`);
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

/** Upload a blob to storage; returns the public URL. */
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
  return `${cfg.url}/storage/v1/object/public/${BUCKET}/${encodeURI(path)}`;
}

export async function downloadImage(url) {
  const res = await fetch(url);
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
