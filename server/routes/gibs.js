// GET /api/gibs/meta — available date ranges and legend URLs for the dated GIBS
// layers in the catalog. Parsed from NASA's WMTS GetCapabilities document
// (≈5 MB), cached server-side so browsers never download it.

import { LAYERS, TRUE_COLOR_GIBS } from '../../shared/catalog.js';

const CAPS_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml';
const LEGEND_PREFIX = 'https://gibs.earthdata.nasa.gov/legends/';
const DATE_AT_START = /^(\d{4}-\d{2}-\d{2})/;

/**
 * Extract {start, end, legend} for each wanted GIBS layer identifier.
 * Linear scan (indexOf) rather than a regex over the whole document.
 * @param {string} xml
 * @param {string[]} wantedIds GIBS identifiers
 * @returns {Record<string, {start: string|null, end: string|null, legend: string|null}>}
 */
export function parseGibsCapabilities(xml, wantedIds) {
  const wanted = new Set(wantedIds);
  const out = {};
  let pos = 0;
  while (wanted.size) {
    const start = xml.indexOf('<Layer>', pos);
    if (start < 0) break;
    const end = xml.indexOf('</Layer>', start);
    if (end < 0) break;
    pos = end + 8;
    const block = xml.slice(start, end);
    const idMatch = /<ows:Identifier>([^<]+)<\/ows:Identifier>/.exec(block);
    if (!idMatch || !wanted.has(idMatch[1])) continue;
    wanted.delete(idMatch[1]);

    const values = [...block.matchAll(/<Value>([^<]+)<\/Value>/g)].map((m) => m[1]);
    const firstDate = values.length ? DATE_AT_START.exec(values[0])?.[1] ?? null : null;
    const lastParts = values.length ? values[values.length - 1].split('/') : [];
    const lastEnd = lastParts.length ? DATE_AT_START.exec(lastParts[1] ?? lastParts[0])?.[1] ?? null : null;
    const dflt = DATE_AT_START.exec(/<Default>([^<]+)<\/Default>/.exec(block)?.[1] ?? '')?.[1] ?? null;

    const legendRaw = /<LegendURL[^>]*legend-type\/horizontal[^>]*xlink:href=['"]([^'"]+)['"]/.exec(block)?.[1] ?? null;
    const legend = legendRaw && legendRaw.startsWith(LEGEND_PREFIX) && legendRaw.endsWith('.svg') ? legendRaw : null;

    out[idMatch[1]] = { start: firstDate, end: dflt || lastEnd, legend };
  }
  return out;
}

export function registerGibsRoutes({ router, ctx }) {
  const dated = LAYERS.filter((l) => l.kind === 'gibs' && l.gibs.dated);

  router.add('GET', '/api/gibs/meta', async () => {
    const { value, state, fetchedAt } = await ctx.cache.wrap('gibs:meta', { ttlMs: 6 * 3600e3, staleMs: 7 * 86400e3, persist: true }, async () => {
      const res = await ctx.safeFetch(CAPS_URL, { maxBytes: 20_000_000, timeoutMs: 60_000, headers: { accept: 'application/xml' } });
      if (!res.ok) throw new Error(`GIBS capabilities HTTP ${res.status}`);
      const parsed = parseGibsCapabilities(res.text(), [...dated.map((l) => l.gibs.layer), TRUE_COLOR_GIBS.layer]);
      const layers = {};
      for (const l of dated) if (parsed[l.gibs.layer]) layers[l.id] = parsed[l.gibs.layer];
      if (parsed[TRUE_COLOR_GIBS.layer]) layers['true-color'] = parsed[TRUE_COLOR_GIBS.layer]; // basemap, keyed by its map-stack id
      return layers;
    });
    return { body: { state, updatedAt: new Date(fetchedAt).toISOString(), layers: value }, headers: { 'x-tc-cache': state, 'cache-control': 'public, max-age=900' } };
  });
}
