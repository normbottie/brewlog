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
export async function nearbyCafes({ lat, lng }, radius = 1200, limit = 40) {
  const query = `[out:json][timeout:20];
(
  node["amenity"~"^(cafe|coffee_shop)$"](around:${radius},${lat},${lng});
  way["amenity"~"^(cafe|coffee_shop)$"](around:${radius},${lat},${lng});
  node["cuisine"="coffee_shop"](around:${radius},${lat},${lng});
);
out center ${limit};`;

  let lastErr = null;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
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
