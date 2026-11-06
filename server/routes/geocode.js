// GET /api/geocode?q=Kaduna&limit=3
//
// 1. Bundled gazetteer (Natural Earth) and named natural regions — instant,
//    offline, covers Africa well.
// 2. Fallback: OpenStreetMap Nominatim, honouring its usage policy: identifying
//    User-Agent, ≤ 1 request/second (serialised here), aggressive caching.
//    Results are © OpenStreetMap contributors (ODbL).

import { haversineKm } from '../../shared/gazetteer.js';
import { HttpError } from '../http.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const MIN_GAP_MS = 1100;
const MAX_QUEUE = 4;

/**
 * What we both cache on and send upstream: trimmed, lower-cased, whitespace-collapsed.
 * Deliberately NOT shared/gazetteer normalize(): that also drops accents and punctuation,
 * which would make the key coarser than the request.
 */
export const canonicalQuery = (q) => String(q ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Map a Nominatim hit to our result shape; null if unusable. */
export function nominatimToResult(hit) {
  const lat = Number(hit?.lat); const lon = Number(hit?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  let altKm = 80; let bbox = null;
  if (Array.isArray(hit.boundingbox) && hit.boundingbox.length === 4) {
    const [s, n, w, e] = hit.boundingbox.map(Number);
    if ([s, n, w, e].every(Number.isFinite)) {
      bbox = [w, s, e, n];
      altKm = Math.min(7000, Math.max(40, Math.round(haversineKm(s, w, n, e) * 1.3)));
    }
  }
  return {
    name: String(hit.name || hit.display_name || '').slice(0, 120),
    label: String(hit.display_name || '').slice(0, 200),
    type: String(hit.addresstype || hit.type || 'place'), country: null, admin1: null,
    lat, lon, altKm, bbox, source: 'nominatim',
  };
}

export function registerGeocodeRoutes({ router, ctx }) {
  let last = 0; let waiting = 0; let chain = Promise.resolve();
  function throttled(fn) {
    if (waiting >= MAX_QUEUE) throw new HttpError(429, 'geocoder_busy', 'geocoder is busy; try again in a moment');
    waiting += 1;
    const run = chain.then(async () => {
      const wait = Math.max(0, last + MIN_GAP_MS - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return fn();
    }).finally(() => { waiting -= 1; });
    chain = run.catch(() => {});
    return run;
  }

  /** Remote lookup, cached for a month. Shared with the NLP place resolver via ctx. */
  ctx.geocodeRemote = ctx.cfg.geocoder.mode === 'off' ? null : async (rawQuery) => {
    // The cache key and the upstream request use the SAME string, so one spelling can
    // never fill the cache entry that another spelling is then served from.
    const q = canonicalQuery(rawQuery);
    const { value } = await ctx.cache.wrap(`geo:${q}`, { ttlMs: 30 * 86400e3, staleMs: 365 * 86400e3, persist: true }, () => throttled(async () => {
      const res = await ctx.safeFetch(`${NOMINATIM}?q=${encodeURIComponent(q)}&format=jsonv2&limit=5&addressdetails=0`, {
        headers: { 'user-agent': ctx.cfg.geocoder.userAgent, 'accept-language': 'en' }, timeoutMs: 15_000,
      });
      if (!res.ok) throw new HttpError(502, 'upstream_error', `Nominatim HTTP ${res.status}`);
      return res.json().map(nominatimToResult).filter(Boolean);
    }));
    return value;
  };

  router.add('GET', '/api/geocode', async ({ url }) => {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q || q.length > 120) throw new HttpError(400, 'bad_request', 'q must be 1–120 characters');
    const limit = Math.min(5, Math.max(1, Number(url.searchParams.get('limit')) || 3));

    const local = await ctx.places.resolve(q, { remote: false });
    if (local) return { body: { query: q, results: [local] }, headers: { 'cache-control': 'public, max-age=86400' } };
    if (!ctx.geocodeRemote) return { body: { query: q, results: [] } };
    const results = await ctx.geocodeRemote(q);
    return {
      body: { query: q, results: results.slice(0, limit), attribution: '© OpenStreetMap contributors' },
      headers: { 'cache-control': 'public, max-age=3600' },
    };
  });
}
