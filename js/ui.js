/* Small DOM/UI helpers shared by the views. */

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* Icons are inlined rather than referenced from a <use> sprite: iOS Safari
   intermittently fails to paint <use href="#id"> pointing into a zero-sized
   inline SVG, which showed up as empty circles in the top bar. */
const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';

const ICONS = {
  bean: `<g ${STROKE}><ellipse cx="12" cy="12" rx="9" ry="6.4" transform="rotate(-40 12 12)"/>
         <path d="M7.6 16.4c1-3.2 4.6-6.8 7.8-8.8"/></g>`,
  plus: `<g ${STROKE} stroke-width="1.9"><path d="M12 5v14M5 12h14"/></g>`,
  map: `<g ${STROKE}><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"/>
        <circle cx="12" cy="10" r="2.6"/></g>`,
  gear: `<g ${STROKE}><circle cx="12" cy="12" r="3.1"/>
         <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/></g>`,
  search: `<g ${STROKE} stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></g>`,
  back: `<g ${STROKE} stroke-width="1.9"><path d="M15 19 8 12l7-7"/></g>`,
  camera: `<g ${STROKE} stroke-width="1.6"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7a2 2 0 0 0 1.7-1l.5-.8A2 2 0 0 1 11 3h2a2 2 0 0 1 1.7 1l.4.9a2 2 0 0 0 1.7 1h1.7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5Z"/>
           <circle cx="12" cy="13" r="3.7"/></g>`,
  trash: `<g ${STROKE}><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12.2A2 2 0 0 0 8.5 21h7a2 2 0 0 0 2-1.8L18.5 7M9 7V4.6A1.6 1.6 0 0 1 10.6 3h2.8A1.6 1.6 0 0 1 15 4.6V7"/></g>`,
  edit: `<g ${STROKE}><path d="M16.6 3.9a2.1 2.1 0 0 1 3 3L8 18.5l-4 1 1-4Z"/></g>`,
  sparkle: `<g ${STROKE}><path d="M12 3.2 13.7 9l5.8 1.7-5.8 1.7L12 18.2l-1.7-5.8L4.5 10.7 10.3 9Z"/>
            <path d="M18.6 3v3.2M17 4.6h3.2"/></g>`,
  locate: `<g ${STROKE}><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.3"/>
           <path d="M12 2v2.4M12 19.6V22M22 12h-2.4M4.4 12H2"/></g>`,
};

export const icon = (name, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;

const STAR_PATH =
  'M12 2.6l2.85 5.94 6.4.9-4.64 4.6 1.11 6.5L12 17.48 6.28 20.54l1.1-6.5-4.63-4.6 6.4-.9z';

export function stars(value, { size = '', interactive = false } = {}) {
  let out = `<span class="stars ${size} ${interactive ? 'input' : ''}" ${interactive ? 'role="radiogroup" aria-label="Rating"' : ''}>`;
  for (let i = 1; i <= 5; i++) {
    out += `<svg viewBox="0 0 24 24" data-star="${i}" ${interactive ? `role="radio" aria-checked="${i === value}" tabindex="0"` : ''}>
      <path class="${i <= value ? 'star-full' : 'star-empty'}" d="${STAR_PATH}"/></svg>`;
  }
  return out + '</span>';
}

/** Wire a star group rendered with interactive:true. */
export function bindStars(el, onChange) {
  el.addEventListener('click', (e) => {
    const svg = e.target.closest('[data-star]');
    if (!svg) return;
    const v = Number(svg.dataset.star);
    onChange(v);
  });
}

export function toast(msg, ms = 2400) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = h(`<div class="toast">${esc(msg)}</div>`);
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/** Bottom sheet. `render(close)` returns markup or a node. */
export function sheet(title, render) {
  const backdrop = h(`<div class="sheet-backdrop"><div class="sheet">
    <div class="grabber"></div>${title ? `<h3>${esc(title)}</h3>` : ''}
    <div class="sheet-body"></div></div></div>`);
  const close = () => {
    backdrop.style.transition = 'opacity .2s';
    backdrop.style.opacity = '0';
    setTimeout(() => backdrop.remove(), 200);
  };
  const body = backdrop.querySelector('.sheet-body');
  const content = render(close);
  if (typeof content === 'string') body.innerHTML = content;
  else if (content) body.appendChild(content);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.body.appendChild(backdrop);
  return { el: backdrop, close };
}

export function confirmSheet(title, message, confirmLabel = 'Delete') {
  return new Promise(resolve => {
    const s = sheet(title, (close) => {
      const node = h(`<div>
        <p style="color:var(--text-muted);margin:0 0 20px;line-height:1.55">${esc(message)}</p>
        <div class="stack">
          <button class="btn-danger btn-block" data-yes>${esc(confirmLabel)}</button>
          <button class="btn-block" data-no>Cancel</button>
        </div></div>`);
      node.querySelector('[data-yes]').onclick = () => { close(); resolve(true); };
      node.querySelector('[data-no]').onclick = () => { close(); resolve(false); };
      return node;
    });
    s.el.addEventListener('click', e => { if (e.target === s.el) resolve(false); });
  });
}

export function empty(iconName, title, body) {
  return `<div class="empty glass card-pad">
    ${icon(iconName)}<h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Keep range inputs' filled-track CSS variable in sync. */
export function bindRange(input) {
  const sync = () => {
    const min = Number(input.min || 0), max = Number(input.max || 100);
    input.style.setProperty('--pct', `${((input.value - min) / (max - min)) * 100}%`);
  };
  input.addEventListener('input', sync);
  sync();
}
