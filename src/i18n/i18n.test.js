import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createI18n } from './core.js';
import { checkLocales } from '../../scripts/check-i18n.mjs';
import { LANGUAGES, pickLanguage } from '../../shared/languages.js';

const fsLoad = async (code) => JSON.parse(readFileSync(new URL(`./locales/${code}.json`, import.meta.url), 'utf8'));
const make = () => createI18n({ load: fsLoad });

test('every locale has the same keys and placeholders as English', () => {
  const { errors } = checkLocales();
  assert.deepEqual(errors, []);
});

test('lookup falls back: language → English → key', async () => {
  const warns = []; const i = createI18n({ load: async (c) => (c === 'en' ? { a: 'Hello {name}', b: 'only English' } : { a: 'Bonjour {name}' }), onWarn: (m) => warns.push(m) });
  await i.setLanguage('fr');
  assert.equal(i.t('a', { name: 'Ada' }), 'Bonjour Ada');
  assert.equal(i.t('b'), 'only English');
  assert.equal(i.t('nope'), 'nope');
  assert.equal(warns.length, 1);
  assert.equal(i.t('a'), 'Bonjour {name}', 'missing params stay visible rather than becoming "undefined"');
});

test('unknown language codes fall back to English; change events fire', async () => {
  const i = make(); const seen = [];
  i.onChange((l) => seen.push(l));
  await i.setLanguage('zz');
  assert.equal(i.getLanguage(), 'en');
  await i.setLanguage('ha');
  assert.deepEqual(seen, ['en', 'ha']);
  assert.equal(i.t('panel.layers'), 'Layuka');
});

test('all eight languages load and translate a real UI key differently', async () => {
  const seen = new Set();
  for (const { code } of LANGUAGES) {
    const i = make(); await i.setLanguage(code);
    seen.add(i.t('nlp.flying', { place: 'Kano' }));
    assert.ok(i.t('nlp.flying', { place: 'Kano' }).includes('Kano'), `${code} keeps the placeholder value`);
  }
  assert.equal(seen.size, LANGUAGES.length, 'no two languages share an identical string');
});

test('numbers and dates use Latin digits even in Arabic', async () => {
  const i = make(); await i.setLanguage('ar');
  assert.match(i.number(1234.5), /^[\d,.\s٬٫]+$/);
  assert.ok(!/[٠-٩]/.test(i.number(2026)), 'no Arabic-Indic digits');
  assert.ok(!/[٠-٩]/.test(i.date('2026-11-05')));
  assert.ok(!/[٠-٩]/.test(i.month('2026-09')));
  assert.ok(i.info().dir === 'rtl');
});

test('signed numbers always show their sign (anomalies)', async () => {
  const i = make(); await i.setLanguage('en');
  assert.equal(i.signed(0.72), '+0.7');
  assert.equal(i.signed(-1.24), '-1.2');
  assert.equal(i.signed(0), '0.0');
});

test('pickLanguage honours browser preferences, ignoring region tags', () => {
  assert.equal(pickLanguage(['fr-CA', 'en']), 'fr');
  assert.equal(pickLanguage(['yo-NG']), 'yo');
  assert.equal(pickLanguage(['de', 'es']), 'en');
  assert.equal(pickLanguage([]), 'en');
});
