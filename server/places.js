// One place-name resolver for the whole server (geocode route, NLP tools,
// offline parser): gazetteer → natural regions → remote geocoder.

import { normalize } from '../shared/gazetteer.js';
import { findNaturalRegion } from '../src/geo/naturalEarthRegions.js';

export function entityToResult(e, source = 'gazetteer') {
  return {
    name: e.name, type: e.type, country: e.country ?? null, admin1: e.admin1 ?? null,
    lat: e.lat, lon: e.lon, altKm: e.altKm, bbox: e.bbox ?? null, source,
  };
}

/** Natural Earth region → result with a centre point and fit altitude. */
export function regionToResult(r) {
  let w = 180; let s = 90; let e = -180; let n = -90;
  for (const ring of r.polygons) for (const [lon, lat] of ring) { if (lon < w) w = lon; if (lon > e) e = lon; if (lat < s) s = lat; if (lat > n) n = lat; }
  return {
    name: r.name, type: r.kind === 'marine' ? 'sea' : 'region', country: null, admin1: null,
    lat: (s + n) / 2, lon: (w + e) / 2,
    altKm: Math.min(9000, Math.max(250, Math.round(r.bboxDiagonalKm * 1.3))),
    bbox: [w, s, e, n], source: 'natural-earth',
  };
}

/**
 * @param {{gazetteer: ReturnType<import('../shared/gazetteer.js').createGazetteer>, getRemote?: () => ((q: string) => Promise<object[]>) | null}} deps
 */
export function createPlaceResolver({ gazetteer, getRemote = () => null }) {
  async function localResolve(query) {
    const g = gazetteer.find(query);
    if (g) return entityToResult(g);
    const region = await findNaturalRegion(query).catch(() => null);
    return region ? regionToResult(region) : null;
  }

  return {
    /** Resolve a place name. Returns a result object or null. Never throws on "not found". */
    async resolve(query, { remote = true } = {}) {
      const q = String(query ?? '').trim();
      if (!q || q.length > 120) return null;
      const local = await localResolve(q);
      if (local) return local;
      const fn = remote ? getRemote() : null;
      if (!fn) return null;
      try { return (await fn(q))[0] ?? null; } catch { return null; }
    },

    /** Find a place mentioned anywhere in free text (offline only: no network). */
    async findInText(text) {
      const g = gazetteer.findInTextDetailed(text);
      const toks = normalize(text).split(' ').filter(Boolean);
      let best = g ? { result: entityToResult(g.entity), span: g.span } : null;
      for (let i = 0; i < toks.length; i++) {
        for (let len = Math.min(4, toks.length - i); len >= 1; len--) {
          if (best && len <= best.span) break;
          if (len === 1 && toks[i].length < 4) continue;
          const region = await findNaturalRegion(toks.slice(i, i + len).join(' ')).catch(() => null);
          if (region) { best = { result: regionToResult(region), span: len }; break; }
        }
      }
      return best?.result ?? null;
    },
  };
}
