// Application state + shareable-link (URL hash) codec.
//
// A link like  #c=6.52,3.38,120&l=precip,ndvi&d=2026-10-30&b=true-color&lang=fr
// restores camera, layers, date, basemap and language. The hash is UNTRUSTED
// input (anyone can craft a link and send it to someone), so decoding
// validates every field against the catalog and range-checks every number.

import { BASEMAP_IDS, EMISSION_SECTORS, LAYER_IDS, isValidDate } from '../shared/catalog.js';
import { LANGUAGE_CODES } from '../shared/languages.js';

export const DEFAULT_VIEW = Object.freeze({ lat: 9.1, lon: 8.7, altKm: 2200 });

export function defaultState() {
  return {
    layers: [], // enabled layer ids, in the order they were turned on
    opacity: {}, // id -> 0..1 overrides
    date: null, // null = each layer's newest available date
    basemap: 'blue-marble',
    reference: true, // borders + place names overlay
    lang: null, // null = detect
    emissions: { country: 'NGA', sector: 'all' },
    view: { ...DEFAULT_VIEW },
    dataSaver: false,
  };
}

const inRange = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
const ISO3 = /^[A-Z]{3}$/;

/** State → hash string (without the leading #). Defaults are omitted to keep links short. */
export function encodeHash(s) {
  const p = new URLSearchParams();
  const v = s.view;
  if (v && inRange(v.lat, -90, 90) && inRange(v.lon, -180, 180) && inRange(v.altKm, 0.05, 60000)) {
    p.set('c', `${v.lat.toFixed(3)},${v.lon.toFixed(3)},${Math.round(v.altKm)}`);
  }
  if (s.layers.length) p.set('l', s.layers.join(','));
  const ops = Object.entries(s.opacity).filter(([id, a]) => s.layers.includes(id) && inRange(a, 0, 1));
  if (ops.length) p.set('o', ops.map(([id, a]) => `${id}:${Math.round(a * 100)}`).join(','));
  if (s.date) p.set('d', s.date);
  if (s.basemap !== 'blue-marble') p.set('b', s.basemap);
  if (!s.reference) p.set('ref', '0');
  if (s.lang) p.set('lang', s.lang);
  if (s.layers.includes('emissions') && s.emissions) p.set('e', `${s.emissions.country}:${s.emissions.sector}`);
  if (s.dataSaver) p.set('ds', '1');
  return p.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
}

/** Hash string → partial, fully validated state. Unknown/invalid fields are dropped silently. */
export function decodeHash(hash) {
  const out = {};
  let p;
  try { p = new URLSearchParams(String(hash || '').replace(/^#/, '')); } catch { return out; }

  const c = (p.get('c') || '').split(',').map(Number);
  if (c.length === 3 && inRange(c[0], -90, 90) && inRange(c[1], -180, 180) && inRange(c[2], 0.05, 60000)) out.view = { lat: c[0], lon: c[1], altKm: c[2] };

  if (p.has('l')) out.layers = [...new Set(p.get('l').split(',').filter((id) => LAYER_IDS.includes(id)))];
  if (p.has('o')) {
    const o = {};
    for (const part of p.get('o').split(',')) {
      const [id, pct] = part.split(':');
      const a = Number(pct) / 100;
      if (LAYER_IDS.includes(id) && inRange(a, 0, 1)) o[id] = a;
    }
    out.opacity = o;
  }
  if (isValidDate(p.get('d')) && p.get('d') >= '2000-01-01') out.date = p.get('d');
  if (BASEMAP_IDS.includes(p.get('b'))) out.basemap = p.get('b');
  if (p.get('ref') === '0') out.reference = false;
  if (LANGUAGE_CODES.includes(p.get('lang'))) out.lang = p.get('lang');
  const [ec, es] = (p.get('e') || '').split(':');
  if (ISO3.test(ec || '') && (es === 'all' || EMISSION_SECTORS.includes(es))) out.emissions = { country: ec, sector: es };
  if (p.get('ds') === '1') out.dataSaver = true;
  return out;
}

/** Minimal observable store. `set` shallow-merges and notifies only on real change. */
export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = { ...state, ...patch };
      const changed = Object.keys(patch).filter((k) => JSON.stringify(state[k]) !== JSON.stringify(next[k]));
      if (!changed.length) return;
      const prev = state;
      state = next;
      for (const fn of subs) fn(state, prev, changed);
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
