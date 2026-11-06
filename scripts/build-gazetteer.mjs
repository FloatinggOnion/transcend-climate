#!/usr/bin/env node
// Builds shared/gazetteer.json from Natural Earth (public domain), pinned to a
// specific upstream commit and verified by SHA-256 so the build is reproducible
// and tamper-evident.
//
//   node scripts/build-gazetteer.mjs
//
// Output: African populated places + all world capitals, every country (bbox +
// FR/AR/PT names), and synthesized admin-1 entries (e.g. Nigeria's 36 states+FCT).

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT = 'ca96624a56bd078437bca8184e78163e5039ad19';
const BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${COMMIT}/geojson`;
const SOURCES = {
  places: { file: 'ne_10m_populated_places_simple.geojson', sha256: 'fd3fa867a320cbd5c5b6bb5bc550afeec2939fb2cef688e508007282a55ac42f' },
  countries: { file: 'ne_50m_admin_0_countries.geojson', sha256: '3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb' },
  borders: { file: 'ne_50m_admin_0_boundary_lines_land.geojson', sha256: '2faac4f6b34386f3d21b6e018cf151f241f00e5c936d44dd17d7d9bfb147fa48' },
};

async function load({ file, sha256 }) {
  const res = await fetch(`${BASE}/${file}`, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== sha256) throw new Error(`${file}: SHA-256 mismatch\n  expected ${sha256}\n  got      ${got}`);
  return JSON.parse(buf.toString('utf8'));
}

const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

function bboxOf(geom) {
  let w = 180, s = 90, e = -180, n = -90;
  const walk = (c) => { if (typeof c[0] === 'number') { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); } else c.forEach(walk); };
  walk(geom.coordinates);
  return [round(w), round(s), round(e), round(n)];
}

const [placesFc, countriesFc, bordersFc] = await Promise.all([load(SOURCES.places), load(SOURCES.countries), load(SOURCES.borders)]);

const countries = [];
const africa = new Set();
for (const f of countriesFc.features) {
  const p = f.properties;
  const iso3 = p.ISO_A3_EH && p.ISO_A3_EH !== '-99' ? p.ISO_A3_EH : p.ADM0_A3;
  if (!iso3 || iso3 === '-99') continue;
  if (p.CONTINENT === 'Africa') africa.add(iso3);
  countries.push({
    iso3, iso2: p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : null,
    name: p.NAME_EN || p.NAME, continent: p.CONTINENT,
    names: { fr: p.NAME_FR || null, ar: p.NAME_AR || null, pt: p.NAME_PT || null },
    alt: [p.NAME, p.NAME_LONG, p.NAME_CIAWF].filter((x, i, a) => x && a.indexOf(x) === i && x !== (p.NAME_EN || p.NAME)),
    bbox: bboxOf(f.geometry),
  });
}

const places = [];
const admin1 = new Map(); // key iso3|adm1 -> {lat,lon,pop,n,capLat,capLon}
for (const f of placesFc.features) {
  const p = f.properties;
  const iso3 = p.adm0_a3;
  const isCap = p.adm0cap === 1;
  if (!africa.has(iso3) && !isCap) continue;
  const rank = isCap ? 2 : /admin-1 capital/i.test(p.featurecla) ? 1 : 0;
  places.push({
    name: p.name, ascii: p.nameascii !== p.name ? p.nameascii : undefined,
    alt: p.namealt ? p.namealt.split(/[;,]/).map((s) => s.trim()).filter(Boolean) : undefined,
    country: iso3, admin1: p.adm1name || undefined, cap: rank,
    lat: round(p.latitude, 4), lon: round(p.longitude, 4), pop: p.pop_max || 0,
  });
  if (africa.has(iso3) && p.adm1name) {
    const key = `${iso3}|${p.adm1name}`;
    const a = admin1.get(key) || { country: iso3, name: p.adm1name, n: 0, lat: 0, lon: 0, pop: 0 };
    a.n += 1; a.lat += p.latitude; a.lon += p.longitude; a.pop += p.pop_max || 0;
    if (rank === 1 || (rank === 2 && !a.cap)) { a.capLat = p.latitude; a.capLon = p.longitude; a.cap = true; }
    admin1.set(key, a);
  }
}
const states = [...admin1.values()].map((a) => ({
  name: a.name, country: a.country,
  lat: round(a.capLat ?? a.lat / a.n, 4), lon: round(a.capLon ?? a.lon / a.n, 4), pop: a.pop,
}));

// Hand-added entries Natural Earth's populated-places layer does not cover.
// Plain geographic facts (state capitals / well-known features), kept small and
// reviewable. Coordinates are the capital city or feature centre, 4 dp.
const SUPPLEMENT_ADMIN1 = [
  { name: 'Bayelsa', country: 'NGA', lat: 4.9247, lon: 6.2642, pop: 0 }, // Yenagoa
  { name: 'Ebonyi', country: 'NGA', lat: 6.3249, lon: 8.1137, pop: 0 }, // Abakaliki
];
const LANDMARKS = [
  { name: 'Lake Chad', country: 'TCD', lat: 13.0, lon: 14.3 },
  { name: 'Lake Victoria', country: 'UGA', lat: -1.0, lon: 33.0 },
  { name: 'Kainji Lake', country: 'NGA', lat: 10.0, lon: 4.6 },
  { name: 'Mount Kilimanjaro', country: 'TZA', lat: -3.0674, lon: 37.3556 },
  { name: 'Mount Kenya', country: 'KEN', lat: -0.1521, lon: 37.3084 },
  { name: 'Victoria Falls', country: 'ZWE', lat: -17.9243, lon: 25.8572 },
  { name: 'Okavango Delta', country: 'BWA', lat: -19.3, lon: 22.9 },
  { name: 'Serengeti', country: 'TZA', lat: -2.3333, lon: 34.8333 },
  { name: 'Mount Cameroon', country: 'CMR', lat: 4.2033, lon: 9.1700 },
];
const have = new Set(states.map((s) => `${s.country}|${s.name}`));
for (const s of SUPPLEMENT_ADMIN1) if (!have.has(`${s.country}|${s.name}`)) states.push(s);
for (const s of states) if (s.country === 'NGA' && s.name === 'Nassarawa') s.alt = ['Nasarawa'];

places.sort((a, b) => (b.pop || 0) - (a.pop || 0));
const out = {
  meta: {
    sources: Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, `${BASE}/${v.file}`])),
    sha256: Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.sha256])),
    commit: COMMIT,
    license: 'Public domain (Natural Earth, naturalearthdata.com)',
    note: 'Africa: all NE populated places + admin-1 areas. World: capitals only. Plus a few hand-added admin-1/landmark entries (see build script).',
    counts: { countries: countries.length, places: places.length, admin1: states.length, landmarks: LANDMARKS.length },
  },
  countries, admin1: states, places, landmarks: LANDMARKS,
};
writeFileSync(join(ROOT, 'shared', 'gazetteer.json'), JSON.stringify(out));

// Country border lines as flat [lon, lat, lon, lat, …] arrays at 2 dp (~1 km), for the map overlay.
const lines = [];
for (const f of bordersFc.features) {
  const parts = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
  for (const part of parts) lines.push(part.flatMap(([lon, lat]) => [round(lon, 2), round(lat, 2)]));
}
writeFileSync(join(ROOT, 'shared', 'borders.json'), JSON.stringify({ meta: { source: `${BASE}/${SOURCES.borders.file}`, sha256: SOURCES.borders.sha256, license: 'Public domain (Natural Earth)' }, lines }));
console.log(`wrote shared/borders.json  lines=${lines.length}`);
console.log(`wrote shared/gazetteer.json  countries=${countries.length} (${africa.size} African) places=${places.length} admin1=${states.length}`);
