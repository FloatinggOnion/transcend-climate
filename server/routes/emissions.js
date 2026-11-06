// GET /api/emissions?country=NGA&sector=all|power|…&year=2025&limit=150
//
// Facility-level greenhouse-gas emissions from Climate TRACE (CC BY 4.0,
// keyless). The API returns assets sorted by emissions, so `limit` gives the
// biggest emitters. We normalise to a small, stable shape for the globe.

import { EMISSION_SECTORS } from '../../shared/catalog.js';
import { HttpError } from '../http.js';

const API = 'https://api.climatetrace.org/v6/assets';
// Sectors made of point-like facilities. Agriculture / land-use / buildings /
// transport are area or network sources whose centroids would mislead on a map.
export const FACILITY_SECTORS = Object.freeze(['power', 'fossil-fuel-operations', 'manufacturing', 'mineral-extraction', 'waste']);
const ISO3 = /^[A-Z]{3}$/;

/** Normalise one Climate TRACE asset; returns null if it can't be drawn. */
export function normalizeAsset(a, sector) {
  const g = a?.Centroid?.Geometry;
  if (!Array.isArray(g) || g.length < 2) return null;
  const [lon, lat] = g;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const summary = (a.EmissionsSummary || []).find((e) => e.Gas === 'co2e_100yr') || a.EmissionsSummary?.[0];
  const co2e = Number(summary?.EmissionsQuantity);
  if (!Number.isFinite(co2e) || co2e <= 0) return null;
  return {
    id: String(a.Id),
    name: String(a.Name || 'Unnamed facility').slice(0, 120),
    sector,
    subsector: a.Sector ? String(a.Sector) : null,
    country: a.Country ? String(a.Country) : null,
    lat, lon,
    co2e, // tonnes CO2-equivalent (100-year GWP) for the requested year
    owners: (a.Owners || []).map((o) => o.CompanyName).filter(Boolean).slice(0, 3),
  };
}

function validateQuery({ country, sector = 'all', year = null, limit = 150 }, ctx) {
  country = String(country || '').toUpperCase();
  if (!ISO3.test(country) || !ctx.gazetteer.country(country)) throw new HttpError(400, 'bad_request', 'country must be a known ISO-3166 alpha-3 code, e.g. NGA');
  if (sector !== 'all' && !EMISSION_SECTORS.includes(sector)) throw new HttpError(400, 'bad_request', `sector must be "all" or one of: ${EMISSION_SECTORS.join(', ')}`);
  const nowYear = new Date(ctx.now()).getUTCFullYear();
  if (year !== null && (!Number.isInteger(year) || year < 2015 || year > nowYear)) throw new HttpError(400, 'bad_request', `year must be an integer in [2015, ${nowYear}]`);
  if (!Number.isInteger(limit) || limit < 1 || limit > 300) throw new HttpError(400, 'bad_request', 'limit must be an integer in [1, 300]');
  return { country, sector, year, limit };
}

export function registerEmissionsRoutes({ router, ctx }) {
  async function fetchSector(country, sector, year, perSector) {
    const url = `${API}?countries=${country}&year=${year}&sectors=${sector}&limit=${perSector}&offset=0`;
    const res = await ctx.safeFetch(url, { timeoutMs: 45_000 });
    if (!res.ok) throw new HttpError(502, 'upstream_error', `Climate TRACE HTTP ${res.status}`);
    const json = res.json();
    return (json.assets || []).map((a) => normalizeAsset(a, sector)).filter(Boolean);
  }

  /** Shared by the HTTP route and the NLP tools. Returns {body, headers}. */
  async function emissions(params) {
    const { country, sector, year: reqYear, limit } = validateQuery(params, ctx);
    const nowYear = new Date(ctx.now()).getUTCFullYear();
    // Climate TRACE publishes the previous year; walk back if a year is empty.
    const candidates = reqYear ? [reqYear] : [nowYear - 1, nowYear - 2, nowYear - 3];
    const sectors = sector === 'all' ? FACILITY_SECTORS : [sector];
    const perSector = sector === 'all' ? Math.min(100, Math.ceil(limit / 2)) : Math.min(100, limit);

    for (const year of candidates) {
      const key = `ct:${country}:${year}:${sector}:${limit}`;
      const { value, state, fetchedAt } = await ctx.cache.wrap(key, { ttlMs: 24 * 3600e3, staleMs: 30 * 86400e3, persist: true }, async () => {
        const perSectorResults = await Promise.all(sectors.map((s) => fetchSector(country, s, year, perSector)));
        const facilities = perSectorResults.flat().sort((a, b) => b.co2e - a.co2e).slice(0, limit);
        return { facilities, total: facilities.reduce((s, f) => s + f.co2e, 0) };
      });
      if (value.facilities.length || year === candidates.at(-1)) {
        return {
          body: {
            country, year, sector, count: value.facilities.length, totalCo2e: value.total, facilities: value.facilities,
            state, updatedAt: new Date(fetchedAt).toISOString(),
            source: 'Climate TRACE', license: 'CC BY 4.0', attribution: 'Climate TRACE (climatetrace.org), CC BY 4.0',
          },
          headers: { 'x-tc-cache': state, 'cache-control': 'public, max-age=900' },
        };
      }
    }
    throw new HttpError(404, 'no_data', 'no emissions data for that country/year');
  }
  ctx.services.emissions = emissions;

  router.add('GET', '/api/emissions', async ({ url }) => {
    const q = url.searchParams;
    return emissions({
      country: q.get('country'),
      sector: q.get('sector') || 'all',
      year: q.get('year') ? Number(q.get('year')) : null,
      limit: q.get('limit') ? Number(q.get('limit')) : 150,
    });
  });
}
