/* Tasting radar — SVG, no dependencies. */

import { AXES, AXIS_LABELS } from './store.js';

const MAX = 5;

/**
 * @param {object} ratings  { aromatics, acidity, sweetness, aftertaste, body }
 * @param {object} opts     { size, showRingLabels }
 * @returns {string} SVG markup
 */
export function radarSVG(ratings = {}, opts = {}) {
  const size = opts.size || 440;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const R = size * 0.325;

  const n = AXES.length;
  const angle = (i) => (-90 + i * (360 / n)) * (Math.PI / 180);
  const pt = (i, r) => [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r];

  const poly = (r) => AXES.map((_, i) => pt(i, r).map(v => v.toFixed(1)).join(',')).join(' ');

  let g = '';

  /* rings */
  for (let k = 1; k <= MAX; k++) {
    g += `<polygon class="grid-line" points="${poly((R * k) / MAX)}"/>`;
  }

  /* spokes */
  AXES.forEach((_, i) => {
    const [x, y] = pt(i, R);
    g += `<line class="spoke" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  });

  /* ring numbers, running left from the centre like the reference chart */
  if (opts.showRingLabels !== false) {
    for (let k = 1; k <= MAX; k++) {
      const x = cx - (R * k) / MAX;
      g += `<text class="ring-label" x="${x.toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle">${k}</text>`;
    }
  }

  /* data */
  const vals = AXES.map(a => {
    const v = Number(ratings[a]);
    return Number.isFinite(v) ? Math.max(0, Math.min(MAX, v)) : 0;
  });
  const dataPts = vals.map((v, i) => pt(i, (R * v) / MAX));
  g += `<polygon class="area" points="${dataPts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}"/>`;
  dataPts.forEach(([x, y]) => {
    g += `<circle class="pt" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5"/>`;
  });

  /* axis labels */
  AXES.forEach((a, i) => {
    const [x, y] = pt(i, R + size * 0.075);
    const dx = Math.cos(angle(i));
    const anchor = dx > 0.3 ? 'start' : dx < -0.3 ? 'end' : 'middle';
    const dy = Math.sin(angle(i)) > 0.3 ? 12 : Math.sin(angle(i)) < -0.3 ? -4 : 5;
    g += `<text class="axis-label" x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anchor}">${AXIS_LABELS[a]}</text>`;
  });

  return `<svg class="radar" viewBox="0 0 ${size} ${size}" role="img"
    aria-label="Tasting profile: ${AXES.map((a, i) => `${AXIS_LABELS[a]} ${vals[i]}`).join(', ')}">${g}</svg>`;
}

/** Tiny sparkline version for list cards. */
export function radarMini(ratings = {}, size = 34) {
  const cx = size / 2, cy = size / 2, R = size * 0.42;
  const n = AXES.length;
  const angle = (i) => (-90 + i * (360 / n)) * (Math.PI / 180);
  const pts = AXES.map((a, i) => {
    const v = Math.max(0, Math.min(5, Number(ratings[a]) || 0));
    const r = (R * v) / 5;
    return `${(cx + Math.cos(angle(i)) * r).toFixed(1)},${(cy + Math.sin(angle(i)) * r).toFixed(1)}`;
  }).join(' ');
  const outline = AXES.map((_, i) =>
    `${(cx + Math.cos(angle(i)) * R).toFixed(1)},${(cy + Math.sin(angle(i)) * R).toFixed(1)}`).join(' ');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <polygon points="${outline}" fill="none" stroke="rgba(255,240,220,.14)" stroke-width="1"/>
    <polygon points="${pts}" fill="rgba(201,168,124,.34)" stroke="#C9A87C" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>`;
}
