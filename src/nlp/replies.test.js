import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createI18n } from '../i18n/core.js';
import { createGazetteer } from '../../shared/gazetteer.js';
import { formatReply } from './replies.js';

const load = async (c) => JSON.parse(readFileSync(new URL(`../i18n/locales/${c}.json`, import.meta.url), 'utf8'));
const gazetteer = createGazetteer(JSON.parse(readFileSync(new URL('../../shared/gazetteer.json', import.meta.url), 'utf8')));
const make = async (lang) => { const i = createI18n({ load }); await i.setLanguage(lang); return i; };

test('LLM free text passes through untouched', async () => {
  assert.equal(formatReply({ reply: 'Rain is up.' }, { i18n: await make('fr'), gazetteer }), 'Rain is up.');
});

test('layer ids are localised and joined per language', async () => {
  const en = await make('en');
  assert.equal(formatReply({ replyKey: 'nlp.layers_and_place', replyParams: { layers: ['precip', 'ndvi'], place: 'Kano' } }, { i18n: en, gazetteer }), 'Showing Rainfall and Vegetation over Kano.');
  const fr = await make('fr');
  assert.equal(formatReply({ replyKey: 'nlp.layers_on', replyParams: { layers: ['precip'] } }, { i18n: fr, gazetteer }), 'Affichage : Précipitations.');
});

test('emissions replies use the localised country name', async () => {
  assert.equal(formatReply({ replyKey: 'nlp.emissions', replyParams: { country: 'SEN' } }, { i18n: await make('fr'), gazetteer }), 'Affichage des émissions pour Sénégal.');
  assert.match(formatReply({ replyKey: 'nlp.emissions', replyParams: { country: 'SEN' } }, { i18n: await make('ar'), gazetteer }), /السنغال/);
});

test('climate result formats signed anomalies, month, and null rain (dry season)', async () => {
  const p = { place: 'Kano', month: '2026-09', tempAnomalyC: 0.83, tempC: 27.87, precipAnomalyPct: -27, precipMmDay: 3.7 };
  const out = formatReply({ replyKey: 'nlp.climate_result', replyParams: p }, { i18n: await make('en'), gazetteer });
  assert.equal(out, 'Kano, September 2026: +0.8 °C versus normal (27.9 °C); rainfall -27% versus normal.');
  const dry = formatReply({ replyKey: 'nlp.climate_result', replyParams: { ...p, precipAnomalyPct: null } }, { i18n: await make('en'), gazetteer });
  assert.match(dry, /rainfall — versus normal/);
});

test('dates are localised; unknown keys fall back to a safe generic message', async () => {
  assert.equal(formatReply({ replyKey: 'nlp.date_set', replyParams: { date: '2026-11-04' } }, { i18n: await make('en'), gazetteer }), 'Date set to Nov 4, 2026.');
  const en = await make('en');
  assert.equal(formatReply({ replyKey: 'nlp.nope' }, { i18n: en, gazetteer }), en.t('chat.error'));
  assert.equal(formatReply(null, { i18n: en, gazetteer }), en.t('chat.error'));
  assert.equal(formatReply({ reply: 123, replyKey: 'nlp.done' }, { i18n: en, gazetteer }), 'Done.', 'a non-string reply is ignored');
});

test('every server reply key the rule parser can emit exists in every language', async () => {
  const keys = ['nlp.flying', 'nlp.layers_on', 'nlp.layers_off', 'nlp.layers_and_place', 'nlp.date_set', 'nlp.language_set', 'nlp.emissions', 'nlp.annotated', 'nlp.cleared', 'nlp.done', 'nlp.help', 'nlp.not_understood', 'nlp.place_not_found', 'nlp.climate_result', 'nlp.climate_unavailable', 'nlp.llm_unavailable', 'nlp.refused', 'nlp.budget_exhausted'];
  for (const lang of ['en', 'fr', 'ha', 'yo', 'ig', 'sw', 'ar', 'pt']) {
    const i = await make(lang);
    for (const k of keys) assert.ok(i.has(k), `${lang} missing ${k}`);
  }
});
