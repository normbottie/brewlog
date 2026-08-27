/* Minimal promise wrapper around IndexedDB. No dependencies. */

const DB_NAME = 'brewlog';
const DB_VERSION = 2;   // 2 adds `brews`

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('beans')) {
        const s = db.createObjectStore('beans', { keyPath: 'id' });
        s.createIndex('updated_at', 'updated_at');
      }
      if (!db.objectStoreNames.contains('cafes')) {
        const s = db.createObjectStore('cafes', { keyPath: 'id' });
        s.createIndex('updated_at', 'updated_at');
      }
      if (!db.objectStoreNames.contains('brews')) {
        const s = db.createObjectStore('brews', { keyPath: 'id' });
        s.createIndex('updated_at', 'updated_at');
        s.createIndex('bean_id', 'bean_id');
      }
      // blobs: { key, blob } — keyed by `${kind}:${id}:${variant}`
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'k' });
      }
      void e;
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (err) { reject(err); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const idb = {
  get:    (store, key)  => tx(store, 'readonly',  s => s.get(key)),
  all:    (store)       => tx(store, 'readonly',  s => s.getAll()),
  put:    (store, val)  => tx(store, 'readwrite', s => s.put(val)),
  putAll: (store, vals) => tx(store, 'readwrite', s => { vals.forEach(v => s.put(v)); return null; }),
  del:    (store, key)  => tx(store, 'readwrite', s => s.delete(key)),
  clear:  (store)       => tx(store, 'readwrite', s => s.clear()),
};

/* ---- meta helpers ---- */
export async function metaGet(k, dflt = null) {
  const r = await idb.get('meta', k);
  return r ? r.v : dflt;
}
export function metaSet(k, v) { return idb.put('meta', { k, v }); }

/* ---- blob helpers ---- */
export async function getBlob(key) {
  const r = await idb.get('blobs', key);
  return r ? r.blob : null;
}
export function putBlob(key, blob) { return idb.put('blobs', { key, blob }); }
export function delBlob(key) { return idb.del('blobs', key); }
