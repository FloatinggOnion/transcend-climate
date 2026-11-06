import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGibsCapabilities } from './gibs.js';
import { buildClimateSummary, snapToGrid } from './climate.js';
import { normalizeAsset } from './emissions.js';
import { parseBbox, selectStations, latestPm25, pm25Band } from './airquality.js';
import { nominatimToResult, canonicalQuery } from './geocode.js';
import { CAPS, climatology, monthly } from '../../test/fixtures.js';

// ───────── GIBS capabilities ─────────

test('GIBS capabilities: start/end dates and horizontal legend for wanted layers only', () => {
  const out = parseGibsCapabilities(CAPS, ['MODIS_Terra_Land_Surface_Temp_Day', 'EVIL_Legend', 'Missing_Layer']);
  assert.deepEqual(out.MODIS_Terra_Land_Surface_Temp_Day, { start: '2000-02-24', end: '2026-11-05', legend: 'https://gibs.earthdata.nasa.gov/legends/MODIS_Land_Surface_Temp_H.svg' });
  assert.equal(out.EVIL_Legend.legend, null, 'legend URLs outside the GIBS legend path are discarded');
  assert.equal(out.Some_Other_Layer, undefined);
  assert.equal(out.Missing_Layer, undefined);
});

// ───────── NASA POWER climate summary (numbers from the real Lagos response) ─────────
test('climate summary: anomalies vs climatology, latest complete month, fill values skipped', () => {
  const s = buildClimateSummary(climatology, monthly);
  assert.equal(s.series.length, 12);
  assert.equal(s.latest.month, '2026-09', 'Oct/Nov 2026 are -999 (unpublished) and must be skipped');
  assert.equal(s.latest.tempAnomalyC, 0.72);
  assert.equal(s.latest.precipAnomalyPct, -27);
  const june = s.series.find((r) => r.month === '2026-06');
  assert.equal(june.precipAnomalyPct, 170, 'June 2026 was ~2.7x the normal');
  assert.ok(!s.series.some((r) => r.month.endsWith('-13')), 'the annual-mean pseudo-month is dropped');
  assert.equal(s.baseline, 'January 2001 - December 2025');
  assert.equal(s.source, 'NASA POWER (MERRA-2)');
});

test('climate summary: percent anomaly is null when the normal is ~0; malformed input throws', () => {
  const dry = JSON.parse(JSON.stringify(climatology)); dry.properties.parameter.PRECTOTCORR.JAN = 0.05;
  const m = { properties: { parameter: { T2M: { 202601: 25 }, PRECTOTCORR: { 202601: 1.0 } } } };
  assert.equal(buildClimateSummary(dry, m).latest.precipAnomalyPct, null);
  assert.throws(() => buildClimateSummary({}, {}), (e) => e.status === 502);
});

test('snapToGrid rounds to the 0.5° native grid', () => {
  assert.deepEqual(snapToGrid(6.4452, 3.3896), { lat: 6.5, lon: 3.5 });
  assert.deepEqual(snapToGrid(-0.2, -179.8), { lat: -0, lon: -180 });
});

// ───────── Climate TRACE ─────────
test('emissions: normalizes assets, rejects undrawable ones', () => {
  const good = { Id: 1, Name: 'Egbin power station', Country: 'NGA', Sector: 'electricity-generation', Centroid: { Geometry: [3.6, 6.6] }, EmissionsSummary: [{ Gas: 'co2e_20yr', EmissionsQuantity: 9 }, { Gas: 'co2e_100yr', EmissionsQuantity: 2060000 }], Owners: [{ CompanyName: 'A' }, { CompanyName: 'B' }, { CompanyName: 'C' }, { CompanyName: 'D' }] };
  const n = normalizeAsset(good, 'power');
  assert.deepEqual({ lat: n.lat, lon: n.lon, co2e: n.co2e, sector: n.sector, id: n.id }, { lat: 6.6, lon: 3.6, co2e: 2060000, sector: 'power', id: '1' });
  assert.equal(n.owners.length, 3);
  assert.equal(normalizeAsset({ ...good, Centroid: null }, 'power'), null);
  assert.equal(normalizeAsset({ ...good, Centroid: { Geometry: [500, 6] } }, 'power'), null);
  assert.equal(normalizeAsset({ ...good, EmissionsSummary: [{ Gas: 'co2e_100yr', EmissionsQuantity: 0 }] }, 'power'), null);
  assert.equal(normalizeAsset({ ...good, EmissionsSummary: [] }, 'power'), null);
  assert.equal(normalizeAsset({ ...good, Name: 'x'.repeat(500) }, 'power').name.length, 120);
});

// ───────── OpenAQ ─────────
test('airquality: bbox validation', () => {
  assert.deepEqual(parseBbox('2.6,4.2,14.7,13.9'), [2.6, 4.2, 14.7, 13.9]);
  for (const bad of ['', '1,2,3', 'a,b,c,d', '10,0,5,5', '-200,0,5,5', '0,0,80,10', '0,0,10,95']) assert.throws(() => parseBbox(bad), (e) => e.status === 400, bad);
});

test('airquality: station selection and latest-value parsing', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const locs = { results: [
    { id: 1, name: 'Lagos – US Embassy', coordinates: { latitude: 6.43, longitude: 3.42 }, datetimeLast: { utc: '2026-11-05T10:00:00Z' }, sensors: [{ id: 11, parameter: { id: 2, name: 'pm25' } }, { id: 12, parameter: { id: 7, name: 'no2' } }] },
    { id: 2, name: 'Stale', coordinates: { latitude: 9, longitude: 7 }, datetimeLast: { utc: '2026-10-01T00:00:00Z' }, sensors: [{ id: 21, parameter: { id: 2, name: 'pm25' } }] },
    { id: 3, name: 'No PM2.5', coordinates: { latitude: 9, longitude: 7 }, datetimeLast: { utc: '2026-11-05T11:00:00Z' }, sensors: [{ id: 31, parameter: { id: 7, name: 'no2' } }] },
    { id: 4, name: 'No coords', datetimeLast: { utc: '2026-11-05T11:00:00Z' }, sensors: [{ id: 41, parameter: { id: 2, name: 'pm25' } }] },
  ] };
  const st = selectStations(locs, now);
  assert.deepEqual(st.map((s) => [s.id, s.sensorId]), [[1, 11]]);
  const latest = { results: [{ sensorsId: 12, value: 99, datetime: { utc: 'x' } }, { sensorsId: 11, value: 42.4, datetime: { utc: '2026-11-05T10:00:00Z' } }] };
  assert.deepEqual(latestPm25(latest, 11), { value: 42.4, time: '2026-11-05T10:00:00Z' });
  assert.equal(latestPm25(latest, 99), null);
  assert.equal(latestPm25({ results: [{ sensorsId: 11, value: -5 }] }, 11), null, 'negative sensor garbage rejected');
  assert.equal(latestPm25({ results: [{ sensorsId: 11, value: 99999 }] }, 11), null, 'absurd values rejected');
});

test('airquality: PM2.5 bands follow the EPA breakpoints', () => {
  assert.equal(pm25Band(5).id, 'good');
  assert.equal(pm25Band(9.0).id, 'good');
  assert.equal(pm25Band(20).id, 'moderate');
  assert.equal(pm25Band(40).id, 'unhealthy_sensitive');
  assert.equal(pm25Band(100).id, 'unhealthy');
  assert.equal(pm25Band(200).id, 'very_unhealthy');
  assert.equal(pm25Band(400).id, 'hazardous');
});

// ───────── Nominatim ─────────
test('nominatim hits map to results; garbage is dropped', () => {
  const r = nominatimToResult({ name: 'Ikeja', display_name: 'Ikeja, Lagos, Nigeria', lat: '6.6018', lon: '3.3515', boundingbox: ['6.5', '6.7', '3.2', '3.4'], addresstype: 'suburb' });
  assert.equal(r.source, 'nominatim');
  assert.ok(r.altKm >= 40 && r.altKm <= 7000);
  assert.equal(nominatimToResult({ lat: 'x', lon: '1' }), null);  assert.equal(nominatimToResult({ lat: '95', lon: '1' }), null);
  assert.equal(nominatimToResult(null), null);
});

test('geocode cache key is exactly what is sent upstream (accents and punctuation are kept)', () => {
  assert.equal(canonicalQuery('  Ibadán   Nigeria '), 'ibadán nigeria');
  // spellings that shared a cache entry under normalize() must now be distinct keys
  assert.notEqual(canonicalQuery('Ibadán'), canonicalQuery('Ibadan'));
  assert.notEqual(canonicalQuery('Lagos, Texas'), canonicalQuery('Lagos Texas'));
  assert.equal(canonicalQuery('KANO'), canonicalQuery(' kano'));
  assert.equal(canonicalQuery('القاهرة'), 'القاهرة', 'non-Latin scripts pass through intact');
  assert.equal(canonicalQuery(undefined), '');
});
