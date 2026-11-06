// GET /api/climate/summary?lat=&lon= — how this month compares with normal.
//
// Source: NASA POWER (MERRA-2 reanalysis), public domain, keyless. We combine
// its 25-year monthly climatology with the recent monthly series to produce an
// anomaly: "this was 1.2 °C warmer / 40 % wetter than the 2001–2025 normal".

import { HttpError } from '../http.js';

const POWER = 'https://power.larc.nasa.gov/api/temporal';
const PARAMS = 'T2M,PRECTOTCORR'; // 2 m air temperature (°C), corrected precipitation (mm/day)
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const FILL = -999;

const valid = (v) => typeof v === 'number' && Number.isFinite(v) && v !== FILL;
const r = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Snap to POWER's native ~0.5° grid so nearby clicks share one cache entry. */
export function snapToGrid(lat, lon) {
  const snap = (v) => Math.round(v * 2) / 2;
  return { lat: snap(lat), lon: snap(lon) };
}

/**
 * Combine POWER climatology + monthly series into the last `n` complete months.
 * @param {object} climatology  POWER /climatology/point JSON
 * @param {object} monthly      POWER /monthly/point JSON
 * @param {number} [n]
 */
export function buildClimateSummary(climatology, monthly, n = 12) {
  const normT = climatology?.properties?.parameter?.T2M;
  const normP = climatology?.properties?.parameter?.PRECTOTCORR;
  const t = monthly?.properties?.parameter?.T2M;
  const p = monthly?.properties?.parameter?.PRECTOTCORR;
  if (!normT || !normP || !t || !p) throw new HttpError(502, 'upstream_shape', 'unexpected NASA POWER response');

  const rows = [];
  for (const key of Object.keys(t).sort()) {
    const month = Number(key.slice(4));
    if (month < 1 || month > 12) continue; // "YYYY13" is POWER's annual mean
    if (!valid(t[key]) || !valid(p[key])) continue; // not yet published
    const name = MONTHS[month - 1];
    const tn = normT[name]; const pn = normP[name];
    if (!valid(tn) || !valid(pn)) continue;
    rows.push({
      month: `${key.slice(0, 4)}-${key.slice(4)}`,
      tempC: r(t[key]), tempNormalC: r(tn), tempAnomalyC: r(t[key] - tn),
      precipMmDay: r(p[key]), precipNormalMmDay: r(pn),
      // Percent anomaly is meaningless when the normal is ~0 (dry season): report null there.
      precipAnomalyPct: pn >= 0.2 ? r(((p[key] - pn) / pn) * 100, 0) : null,
    });
  }
  const series = rows.slice(-n);
  return {
    latest: series.at(-1) ?? null,
    series,
    // POWER describes the period as "... Climatologies (January 2001 - December 2025)".
    baseline: /\(([^)]+)\)/.exec(String(climatology?.header?.range ?? ''))?.[1] ?? 'multi-year climatology',
    source: 'NASA POWER (MERRA-2)',
  };
}

function parseCoord(q, name, min, max) {
  const v = Number(q.get(name));
  if (q.get(name) === null || q.get(name) === '' || !Number.isFinite(v) || v < min || v > max) throw new HttpError(400, 'bad_request', `${name} must be a number in [${min}, ${max}]`);
  return v;
}

export function registerClimateRoutes({ router, ctx }) {
  /** Shared by the HTTP route and the NLP tools. Throws HttpError on bad input / upstream failure. */
  async function climateSummary(latIn, lonIn) {
    const { lat, lon } = snapToGrid(latIn, lonIn);
    const year = new Date(ctx.now()).getUTCFullYear();
    const base = `community=AG&longitude=${lon}&latitude=${lat}&format=JSON`;

    // Climatology never changes within a release: cache for a month, persist across restarts.
    const clim = await ctx.cache.wrap(`power:clim:${lat}:${lon}`, { ttlMs: 30 * 86400e3, staleMs: 365 * 86400e3, persist: true }, async () => {
      const res = await ctx.safeFetch(`${POWER}/climatology/point?parameters=${PARAMS}&${base}`, { timeoutMs: 40_000 });
      if (!res.ok) throw new HttpError(502, 'upstream_error', `NASA POWER HTTP ${res.status}`);
      return res.json();
    });
    const mon = await ctx.cache.wrap(`power:monthly:${year}:${lat}:${lon}`, { ttlMs: 12 * 3600e3, staleMs: 30 * 86400e3, persist: true }, async () => {
      const res = await ctx.safeFetch(`${POWER}/monthly/point?parameters=${PARAMS}&start=${year - 1}&end=${year}&${base}`, { timeoutMs: 40_000 });
      if (!res.ok) throw new HttpError(502, 'upstream_error', `NASA POWER HTTP ${res.status}`);
      return res.json();
    });
    const summary = buildClimateSummary(clim.value, mon.value);
    const state = clim.state === 'stale' || mon.state === 'stale' ? 'stale' : 'fresh';
    return { lat, lon, ...summary, state };
  }
  ctx.services.climateSummary = climateSummary;

  router.add('GET', '/api/climate/summary', async ({ url }) => {
    const q = url.searchParams;
    const body = await climateSummary(parseCoord(q, 'lat', -90, 90), parseCoord(q, 'lon', -180, 180));
    return { body, headers: { 'x-tc-cache': body.state, 'cache-control': 'public, max-age=600' } };
  });
}
