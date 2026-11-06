import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGazetteer, normalize, haversineKm } from './gazetteer.js';

const gz = createGazetteer(JSON.parse(readFileSync(new URL('./gazetteer.json', import.meta.url), 'utf8')));

test('normalize strips accents, punctuation and case', () => {
  assert.equal(normalize("  Côte d'Ivoire "), 'cote d ivoire');
  assert.equal(normalize('São Tomé'), 'sao tome');
});

test('cities resolve with sane coordinates', () => {
  const lagos = gz.find('Lagos');
  assert.equal(lagos.country, 'NGA');
  assert.ok(Math.abs(lagos.lat - 6.45) < 0.2 && Math.abs(lagos.lon - 3.39) < 0.2);
  const kano = gz.find('kano');
  assert.ok(Math.abs(kano.lat - 12.0) < 0.2 && Math.abs(kano.lon - 8.52) < 0.2);
});

test('all 36 states + FCT exist as admin-1 entries', () => {
  const nigerian = gz.entities().filter((e) => e.type === 'admin1' && e.country === 'NGA');
  assert.equal(nigerian.length, 37);
  for (const n of ['Bayelsa', 'Ebonyi', 'Rivers', 'Federal Capital Territory', 'Borno', 'Lagos']) {
    assert.ok(nigerian.some((e) => e.name === n), `missing ${n}`);
  }
  assert.equal(gz.find('Nasarawa')?.country, 'NGA');
});

test('"state" hint prefers the state over the like-named country or city', () => {
  assert.equal(gz.find('Niger')?.type, 'country');
  const niger = gz.find('Niger State');
  assert.equal(niger.type, 'admin1');
  assert.equal(niger.country, 'NGA');
  assert.equal(gz.find('Lagos State').type, 'admin1');
  assert.equal(gz.find('Lagos City').type, 'place');
});

test('all 54 African countries resolve, including common aliases and localized names', () => {
  assert.equal(gz.countries().filter((c) => c.continent === 'Africa').length, 54);
  assert.equal(gz.find('Ivory Coast')?.country, 'CIV');
  assert.equal(gz.find("Côte d'Ivoire")?.country, 'CIV');
  assert.equal(gz.find('DR Congo')?.country, 'COD');
  assert.equal(gz.find('Cape Verde')?.country, 'CPV');
  assert.equal(gz.find('Najeriya')?.country, 'NGA');
  assert.equal(gz.find('Nigéria')?.country, 'NGA'); // fr/pt
  assert.equal(gz.find('نيجيريا')?.country, 'NGA'); // ar
});

test('landmarks resolve', () => {
  assert.equal(gz.find('Lake Chad').type, 'landmark');
  assert.equal(gz.find('Mount Kilimanjaro').country, 'TZA');
});

test('findInText picks the longest, most specific place mention', () => {
  assert.equal(gz.findInText('show rainfall over Lagos please')?.name, 'Lagos');
  assert.equal(gz.findInText('fly to Port Harcourt')?.name, 'Port Harcourt');
  assert.equal(gz.findInText('what is the temperature in Rivers State')?.type, 'admin1');
  assert.equal(gz.findInText('montre-moi la pluie au Sénégal')?.country, 'SEN');
  assert.equal(gz.findInText('show me the weather'), null);
});

test('country altitude scales with size', () => {
  assert.ok(gz.find('Nigeria').altKm > 600 && gz.find('Nigeria').altKm < 2500);
  assert.ok(gz.find('Algeria').altKm > gz.find('Gambia').altKm * 2);
});

test('nearest settlement and countryAt', () => {
  const n = gz.nearest(12.1, 8.6);
  assert.equal(n.place.name, 'Kano');
  assert.ok(n.km < 25);
  assert.equal(gz.countryAt(6.5, 3.4)?.iso3 ?? gz.countryAt(6.5, 3.4)?.country, 'NGA');
  assert.equal(gz.nearest(-60, 0), null, 'remote ocean point has no nearby settlement');
});

test('haversine sanity: Lagos–Abuja ≈ 530 km', () => {
  const d = haversineKm(6.45, 3.39, 9.08, 7.53);
  assert.ok(d > 500 && d < 570, `got ${d}`);
});
