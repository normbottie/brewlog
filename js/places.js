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

export function formatDistance(m) {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
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
  const query = `[out:json][timeout:25];
(
  nwr["amenity"="cafe"]${a};
  nwr["shop"="coffee"]${a};
  nwr["cuisine"~"coffee",i]${a};
  nwr["amenity"="fast_food"]["cuisine"~"coffee",i]${a};
);
out center;`;

  let lastErr = null;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
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
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(lastErr?.message || 'Could not reach the cafe database');
}

/**
 * Widen the search until something turns up, so "nothing here" is a real
 * answer rather than an artefact of the starting radius.
 * @returns {Promise<{results: Array, radius: number}>}
 */
export async function findCafesAround(point, radii = [1500, 5000, 15000]) {
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
