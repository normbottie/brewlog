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

export function setConfig(url, key) {
  try {
    localStorage.setItem(LS_URL, (url || '').trim().replace(/\/+$/, ''));
    localStorage.setItem(LS_KEY, (key || '').trim());
  } catch { /* private mode */ }
}

export function clearConfig() {
  try { localStorage.removeItem(LS_URL); localStorage.removeItem(LS_KEY); } catch {}
}

export function isConfigured() { return !!getConfig(); }

function headers(cfg, extra = {}) {
  return {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
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
  const res = await fetch(`${cfg.url}/rest/v1/${table}?${q}`, { headers: headers(cfg) });
  return (await jsonOrThrow(res)) || [];
}

/** Upsert rows into `table`. */
export async function upsert(table, rows) {
  const cfg = getConfig();
  if (!cfg || !rows.length) return null;
  const res = await fetch(`${cfg.url}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(cfg, {
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
      headers: headers(cfg, {
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

/** Cheap reachability + schema check used by the Settings screen. */
export async function testConnection() {
  const cfg = getConfig();
  if (!cfg) throw new Error('Not configured');
  const res = await fetch(`${cfg.url}/rest/v1/beans?select=id&limit=1`, { headers: headers(cfg) });
  if (res.status === 404) throw new Error('Connected, but the `beans` table is missing — run schema.sql');
  await jsonOrThrow(res);
  return true;
}
