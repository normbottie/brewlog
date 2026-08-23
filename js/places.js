/* Nearby cafe lookup via OpenStreetMap Overpass — free, no key, no billing.
   Coverage is community-sourced: excellent in cities, patchier than Google in
   suburbs. Anything missing can still be added by dropping a pin. */

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const R_EARTH = 6371000;

export function distanceMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

const M_PER_MILE = 1609.344;

export function formatDistance(m) {
  const miles = m / M_PER_MILE;
  if (miles < 0.19) return `${Math.round(m / M_PER_MILE * 5280 / 50) * 50} ft`;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

/** Current position as {lat, lng}; rejects with a readable message. */
export function locate(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This device has no location support')); return; }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      err => reject(new Error(
        err.code === 1 ? 'Location permission denied — allow it in Settings, or drop a pin on the map'
        : err.code === 3 ? 'Timed out getting your location'
        : 'Could not get your location'
      )),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000, ...options }
    );
  });
}

function addressOf(tags = {}) {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:city'],
    tags['addr:state'],
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * Cafes near a point.
 * @returns {Promise<Array<{osm_id, name, address, lat, lng, distance, tags}>>}
 */
export async function nearbyCafes({ lat, lng }, radius = 1500) {
  // Deliberately broad: some cafes are tagged as bakeries, restaurants or
  // plain shops that happen to sell coffee.
  const a = `(around:${radius},${lat},${lng})`;
  const query = `[out:json][timeout:20];
(
  nwr["amenity"="cafe"]${a};
  nwr["shop"="coffee"]${a};
  nwr["cuisine"~"coffee",i]${a};
  nwr["amenity"="fast_food"]["cuisine"~"coffee",i]${a};
);
out center;`;

  /* Overpass mirrors vary from fast to unusable minute to minute, so ask
     both at once, take whichever answers first, and give up after 15s
     rather than leaving the user watching a spinner. */
  const ask = async (url, signal) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          res.status === 429 ? 'The cafe database is rate-limiting us — try again in a minute'
          : res.status === 504 ? 'The cafe database timed out — try again'
          : `Cafe lookup failed (${res.status})${body ? ': ' + body.slice(0, 120) : ''}`
        );
      }
      const json = await res.json();
      const seen = new Set();
      return (json.elements || [])
        .map((el) => {
          const p = el.type === 'node' ? el : el.center;
          if (!p) return null;
          const tags = el.tags || {};
          const name = (tags.name || '').trim();
          if (!name) return null;
          const key = name.toLowerCase() + Math.round(p.lat * 1e4) + Math.round(p.lon * 1e4);
          if (seen.has(key)) return null;
          seen.add(key);
          return {
            osm_id: `${el.type}/${el.id}`,
            name,
            address: addressOf(tags),
            lat: p.lat,
            lng: p.lon,
            distance: distanceMeters({ lat, lng }, { lat: p.lat, lng: p.lon }),
            tags,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.distance - b.distance);
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await Promise.any(ENDPOINTS.map(u => ask(u, controller.signal)));
  } catch (err) {
    const inner = err?.errors?.[0];
    if (controller.signal.aborted) {
      throw new Error('The cafe database is being slow right now — try again in a moment');
    }
    throw new Error(inner?.message || err?.message || 'Could not reach the cafe database');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/**
 * Widen the search until something turns up, so "nothing here" is a real
 * answer rather than an artefact of the starting radius.
 * @returns {Promise<{results: Array, radius: number}>}
 */
export async function findCafesAround(point, radii = [2400, 8000]) {
  let lastErr = null;
  for (const radius of radii) {
    try {
      const results = await nearbyCafes(point, radius);
      if (results.length) return { results, radius };
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return { results: [], radius: radii[radii.length - 1] };
}
