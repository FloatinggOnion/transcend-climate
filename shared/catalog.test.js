import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYERS, TRUE_COLOR_GIBS, addDays, clampDate, gibsUrlTemplate, isValidDate } from './catalog.js';

test('GIBS URLs use the EPSG:3857 pyramid and the XYZ order {z}/{y}/{x}', () => {
  const u = gibsUrlTemplate({ layer: 'MODIS_Terra_Land_Surface_Temp_Day', tms: 'GoogleMapsCompatible_Level7', ext: 'png', dated: true }, '2026-11-03');
  assert.equal(u, 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Land_Surface_Temp_Day/default/2026-11-03/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png');
  const s = gibsUrlTemplate({ layer: 'BlueMarble_ShadedRelief_Bathymetry', tms: 'GoogleMapsCompatible_Level8', ext: 'jpeg', dated: false });
  assert.ok(!s.includes('/2026') && s.endsWith('/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg'));
});

test('URL builder rejects anything that could redirect a request elsewhere', () => {
  const ok = { layer: 'X', tms: 'GoogleMapsCompatible_Level6', ext: 'png', dated: true };
  assert.throws(() => gibsUrlTemplate({ ...ok, layer: '../evil' }, '2026-01-01'));
  assert.throws(() => gibsUrlTemplate({ ...ok, layer: 'a/b' }, '2026-01-01'));
  assert.throws(() => gibsUrlTemplate({ ...ok, tms: '250m' }, '2026-01-01'), /tile matrix/);
  assert.throws(() => gibsUrlTemplate({ ...ok, ext: 'svg' }, '2026-01-01'));
  assert.throws(() => gibsUrlTemplate(ok, 'not-a-date'));
  assert.throws(() => gibsUrlTemplate(ok, '2026-02-30'));
  assert.throws(() => gibsUrlTemplate(ok, null));
});

test('every catalog raster layer builds a valid URL and max level matches its matrix set', () => {
  for (const l of LAYERS.filter((x) => x.kind === 'gibs')) {
    const url = gibsUrlTemplate(l.gibs, l.gibs.dated ? '2026-11-03' : null);
    assert.ok(url.startsWith('https://gibs.earthdata.nasa.gov/'), l.id);
    assert.equal(Number(/Level(\d+)$/.exec(l.gibs.tms)[1]), l.gibs.maxLevel, `${l.id}: maxLevel must equal the GoogleMapsCompatible level`);
  }
  assert.equal(gibsUrlTemplate(TRUE_COLOR_GIBS, '2026-11-03').includes('TrueColor'), true);
});

test('date helpers', () => {
  assert.ok(isValidDate('2026-02-28') && !isValidDate('2026-02-29') && !isValidDate('2026-2-1') && !isValidDate(null));
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(clampDate('2030-01-01', '2000-01-01', '2026-11-05'), '2026-11-05');
  assert.equal(clampDate('1990-01-01', '2000-01-01', '2026-11-05'), '2000-01-01');
  assert.equal(clampDate('2020-05-05', null, null), '2020-05-05');
});
