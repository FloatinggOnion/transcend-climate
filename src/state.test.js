import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, decodeHash, defaultState, encodeHash } from './state.js';

test('round trip: a full state survives encode → decode', () => {
  const s = {
    ...defaultState(), layers: ['precip', 'ndvi', 'emissions'], opacity: { precip: 0.6 }, date: '2026-10-30', basemap: 'true-color',
    reference: false, lang: 'ha', emissions: { country: 'GHA', sector: 'power' }, view: { lat: 6.5234, lon: 3.3801, altKm: 120.4 }, dataSaver: true,
  };
  const d = decodeHash(encodeHash(s));
  assert.deepEqual(d.layers, ['precip', 'ndvi', 'emissions']);
  assert.deepEqual(d.opacity, { precip: 0.6 });
  assert.equal(d.date, '2026-10-30');
  assert.equal(d.basemap, 'true-color');
  assert.equal(d.reference, false);
  assert.equal(d.lang, 'ha');
  assert.deepEqual(d.emissions, { country: 'GHA', sector: 'power' });
  assert.deepEqual(d.view, { lat: 6.523, lon: 3.38, altKm: 120 });
  assert.equal(d.dataSaver, true);
});

test('default state produces a short link (defaults omitted)', () => {
  const h = encodeHash(defaultState());
  assert.ok(h.length < 40, h);
  assert.ok(!h.includes('b=') && !h.includes('lang'));
});

test('links are readable (commas/colons unescaped) and under 200 chars for a busy view', () => {
  const h = encodeHash({ ...defaultState(), layers: ['lst', 'precip', 'clouds', 'ndvi', 'aod'], date: '2026-10-30', lang: 'sw' });
  assert.match(h, /l=lst,precip,clouds,ndvi,aod/);
  assert.ok(h.length < 200);
});

test('hostile hashes are sanitised field by field', () => {
  const d = decodeHash('#c=999,0,10&l=lst,evil,__proto__,<script>&o=lst:500,bad:50,precip:abc&d=2026-13-99&b=javascript:alert(1)&lang=klingon&e=ngA:power&ds=yes');
  assert.equal(d.view, undefined, 'out-of-range coordinates rejected');
  assert.deepEqual(d.layers, ['lst'], 'unknown layer ids dropped');
  assert.deepEqual(d.opacity, {}, 'out-of-range or malformed opacities dropped');
  assert.equal(d.date, undefined);
  assert.equal(d.basemap, undefined);
  assert.equal(d.lang, undefined);
  assert.equal(d.emissions, undefined, 'country must be upper-case ISO-3');
  assert.equal(d.dataSaver, undefined);
  assert.equal(Object.getPrototypeOf(d), Object.prototype);
});

test('garbage input never throws', () => {
  for (const h of ['', '#', '#%', '#c=', '#c=a,b,c', '#l=,,,', 'x'.repeat(10_000), null, undefined, '#e=NGA:']) assert.doesNotThrow(() => decodeHash(h));
});

test('store notifies only on real change and reports which keys changed', () => {
  const store = createStore(defaultState());
  const seen = [];
  store.subscribe((s, prev, changed) => seen.push(changed));
  store.set({ date: null });
  store.set({ date: '2026-11-01' });
  store.set({ date: '2026-11-01' });
  store.set({ layers: ['lst'], basemap: 'true-color' });
  assert.deepEqual(seen, [['date'], ['layers', 'basemap']]);
});
