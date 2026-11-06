// Tiny DOM builder. Everything goes through createElement/textContent/setAttribute,
// so user- or server-supplied strings (place names, facility names, model replies)
// can never be interpreted as HTML. There is no innerHTML anywhere in this app.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * h('button', { class: 'x', onclick: fn, 'aria-label': 'Close' }, 'text', childEl)
 * Attributes starting with "on" are event listeners; `true` sets a boolean attribute;
 * `false`/null/undefined skip the attribute.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

function applyAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.setAttribute('class', v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function replaceChildren(el, ...children) { clear(el); append(el, children); return el; }

/** Focus trap helper for dialogs: returns a release function. */
export function trapFocus(container) {
  const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const handler = (e) => {
    if (e.key !== 'Tab') return;
    const items = [...container.querySelectorAll(sel)].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0]; const last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

export const prefersReducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
