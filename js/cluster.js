/* Pin clustering for the café map.

   Leaflet.markercluster would do this too, but it is another vendored
   dependency for what is sixty lines when all you need is pins that merge
   when they overlap and split as you zoom in.

   Grouping is greedy by screen distance rather than by grid cell: a grid
   leaves pairs that straddle a cell boundary stubbornly unmerged, which
   looks like a bug. Greedy is O(n²), which is nothing for a personal
   café log and stays comfortable into the thousands. */

const DEFAULT_RADIUS = 64;   // px between pin centres before they merge

export function clusterLayer(map, opts = {}) {
  const radius = opts.radius || DEFAULT_RADIUS;
  const layer = L.layerGroup().addTo(map);
  let points = [];

  function groupsAtCurrentZoom() {
    const zoom = map.getZoom();
    const rest = points.map(p => ({ p, pt: map.project([p.lat, p.lng], zoom) }));
    const out = [];
    while (rest.length) {
      const seed = rest.shift();
      const group = [seed];
      for (let i = rest.length - 1; i >= 0; i--) {
        if (seed.pt.distanceTo(rest[i].pt) < radius) group.push(rest.splice(i, 1)[0]);
      }
      out.push(group.map(g => g.p));
    }
    return out;
  }

  function draw() {
    layer.clearLayers();
    if (!points.length) return;

    for (const group of groupsAtCurrentZoom()) {
      if (group.length === 1) {
        const m = opts.marker(group[0]);
        if (m) m.addTo(layer);
        continue;
      }
      const lat = group.reduce((s, p) => s + p.lat, 0) / group.length;
      const lng = group.reduce((s, p) => s + p.lng, 0) / group.length;
      const m = L.marker([lat, lng], {
        icon: opts.clusterIcon(group),
        zIndexOffset: 400,   // a cluster should sit above the loose pins
      }).addTo(layer);

      m.on('click', () => {
        const bounds = L.latLngBounds(group.map(p => [p.lat, p.lng]));
        /* Pins at the very same spot have zero-size bounds, and fitting to
           those moves nothing — step the zoom in instead so the cluster
           visibly responds to being tapped. */
        if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
          map.setView(bounds.getCenter(), Math.min(map.getZoom() + 3, map.getMaxZoom() || 20));
        } else {
          map.fitBounds(bounds, { padding: [55, 55], maxZoom: 17 });
        }
      });
    }
  }

  map.on('zoomend', draw);

  return {
    set(next) { points = (next || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)); draw(); },
    redraw: draw,
    remove() { map.off('zoomend', draw); map.removeLayer(layer); },
  };
}
