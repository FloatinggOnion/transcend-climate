// GET /api/airquality?bbox=minLon,minLat,maxLon,maxLat — latest PM2.5 at
// ground stations, from OpenAQ v3. Needs OPENAQ_API_KEY (free at openaq.org).
//
// NOTE: written against OpenAQ's published v3 docs; it could not be exercised
// against the live API in development because that requires a key. The parse
// functions are unit-tested against fixtures shaped like the documented
// responses — verify with a real key before relying on it (docs/DATA_SOURCES.md).

import { PM25_BANDS } from '../../shared/catalog.js';
import { HttpError } from '../http.js';

const API = 'https://api.openaq.org/v3';
const PM25_PARAMETER_ID = 2;
const MAX_STATIONS = 80;
const MAX_AGE_MS = 48 * 3600e3; // ignore stations that stopped reporting

export const pm25Band = (v) => PM25_BANDS.find((b) => v <= b.max);

export function parseBbox(raw) {
  const parts = String(raw ?? '').split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new HttpError(400, 'bad_request', 'bbox must be minLon,minLat,maxLon,maxLat');
  const [w, s, e, n] = parts;
  if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) throw new HttpError(400, 'bad_request', 'bbox out of range');
  if (e - w > 40 || n - s > 40) throw new HttpError(400, 'bad_request', 'bbox too large (max 40° per side)');
  return [w, s, e, n];
}

/** Locations that expose a PM2.5 sensor and reported recently. Returns [{id,name,lat,lon,sensorId,lastUtc}] */
export function selectStations(locationsJson, nowMs) {
  const out = [];
  for (const loc of locationsJson?.results || []) {
    const sensor = (loc.sensors || []).find((s) => s?.parameter?.id === PM25_PARAMETER_ID || s?.parameter?.name === 'pm25');
    const c = loc.coordinates;
    if (!sensor || !c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) continue;
    const last = Date.parse(loc.datetimeLast?.utc ?? '');
    if (!Number.isFinite(last) || nowMs - last > MAX_AGE_MS) continue;
    out.push({ id: loc.id, name: String(loc.name || `Station ${loc.id}`).slice(0, 80), lat: c.latitude, lon: c.longitude, sensorId: sensor.id, lastUtc: loc.datetimeLast.utc });
  }
  return out.sort((a, b) => Date.parse(b.lastUtc) - Date.parse(a.lastUtc)).slice(0, MAX_STATIONS);
}

/** Pull the latest PM2.5 reading from a /locations/{id}/latest response. */
export function latestPm25(latestJson, sensorId) {
  const row = (latestJson?.results || []).find((r) => r.sensorsId === sensorId);
  if (!row || !Number.isFinite(row.value) || row.value < 0 || row.value > 2000) return null; // reject sensor garbage
  return { value: row.value, time: row.datetime?.utc ?? null };
}

export function registerAirQualityRoutes({ router, ctx }) {
  const headers = () => ({ 'x-api-key': ctx.cfg.openaqKey, accept: 'application/json' });

  router.add('GET', '/api/airquality', async ({ url }) => {
    if (!ctx.cfg.openaqKey) throw new HttpError(503, 'not_configured', 'Set OPENAQ_API_KEY on the server to enable ground-station air quality');
    const bbox = parseBbox(url.searchParams.get('bbox') ?? '2.6,4.2,14.7,13.9');
    // Round to 1° so many nearby viewports share one cache entry (and one upstream call set).
    const rb = bbox.map((v, i) => (i < 2 ? Math.floor(v) : Math.ceil(v)));
    const key = `aq:${rb.join(',')}`;

    const { value, state, fetchedAt } = await ctx.cache.wrap(key, { ttlMs: 10 * 60e3, staleMs: 6 * 3600e3 }, async () => {
      const locRes = await ctx.safeFetch(`${API}/locations?bbox=${rb.join(',')}&parameters_id=${PM25_PARAMETER_ID}&limit=1000`, { headers: headers(), timeoutMs: 30_000 });
      if (locRes.status === 401 || locRes.status === 403) throw new HttpError(502, 'upstream_auth', 'OpenAQ rejected the API key');
      if (locRes.status === 429) throw new HttpError(503, 'upstream_rate_limited', 'OpenAQ rate limit reached; try again shortly');
      if (!locRes.ok) throw new HttpError(502, 'upstream_error', `OpenAQ HTTP ${locRes.status}`);
      const stations = selectStations(locRes.json(), ctx.now());

      // N+1 by design (OpenAQ v3 exposes latest values per location); bounded and parallel-limited.
      const results = []; let i = 0;
      await Promise.all(Array.from({ length: 5 }, async () => {
        while (i < stations.length) {
          const st = stations[i++];
          try {
            const r = await ctx.safeFetch(`${API}/locations/${st.id}/latest`, { headers: headers(), timeoutMs: 20_000 });
            if (!r.ok) continue;
            const reading = latestPm25(r.json(), st.sensorId);
            if (!reading) continue;
            const band = pm25Band(reading.value);
            results.push({ id: st.id, name: st.name, lat: st.lat, lon: st.lon, pm25: Math.round(reading.value * 10) / 10, band: band.id, color: band.color, time: reading.time });
          } catch { /* one bad station must not fail the layer */ }
        }
      }));
      return results;
    });
    return {
      body: { bbox: rb, count: value.length, stations: value, state, updatedAt: new Date(fetchedAt).toISOString(), unit: 'µg/m³', source: 'OpenAQ', attribution: 'OpenAQ (openaq.org) and its data providers' },
      headers: { 'x-tc-cache': state, 'cache-control': 'public, max-age=300' },
    };
  });
}
