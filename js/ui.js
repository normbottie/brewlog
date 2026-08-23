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

export const icon = (name, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"/></svg>`;

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
