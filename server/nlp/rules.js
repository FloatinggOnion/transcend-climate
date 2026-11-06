// Deterministic, multilingual command parser. Produces the same tool-call
// shape an LLM would, so the rest of the pipeline (place resolution,
// validation, execution) is identical for both. Used (a) as the fast path for
// simple commands, saving latency and API cost, and (b) as the only NLP when
// no LLM provider is configured.

import { normalize } from '../../shared/gazetteer.js';
import * as L from '../../shared/nlpLexicon.js';
import { addDays, formatDate, isValidDate } from '../../shared/catalog.js';

const ANNOTATE_KIND = new Map([
  ['circle', 'circle'], ['circule', 'circle'], ['entoure', 'circle'], ['entourer', 'circle'], ['zungushia', 'circle'],
  ['outline', 'outline'], ['contour', 'outline'], ['contorne', 'outline'], ['trace', 'outline'], ['حدد', 'outline'],
]);

/** Build the phrase index once. First registration of a phrase wins. */
function buildIndex() {
  const map = new Map();
  let maxLen = 1;
  const add = (phrases, kind, value = null) => {
    for (const p of phrases) {
      const key = normalize(p);
      if (!key) continue;
      maxLen = Math.max(maxLen, key.split(' ').length);
      if (!map.has(key)) map.set(key, { kind, value });
    }
  };
  add(L.CLIMATE_QUESTION, 'climateq');
  add(L.QUESTION_WORDS, 'question');
  add(L.HELP, 'help');
  add(L.ANNOTATION_NOUNS, 'annNoun');
  add(L.ALL_WORDS, 'all');
  add(L.LANGUAGE_WORDS, 'langword');
  for (const [days, phrases] of Object.entries(L.DATE_WORDS)) add(phrases, 'date', Number(days));
  for (const [code, names] of Object.entries(L.LANGUAGE_NAMES)) add(names, 'lang', code);
  add(L.VERBS.annotate, 'annotate');
  add(L.VERBS.clear, 'clear');
  add(L.VERBS.hide, 'hide');
  add(L.VERBS.show, 'show');
  add(L.VERBS.goto, 'goto');
  for (const [id, phrases] of Object.entries(L.LAYER_TERMS)) add(phrases, 'layer', id);
  for (const [id, phrases] of Object.entries(L.SECTOR_TERMS)) add(phrases, 'sector', id);
  return { map, maxLen };
}
const INDEX = buildIndex();
// Some emissions-layer phrases ("power plants", "factories") also name a sector.
const SECTOR_PHRASE = new Map();
for (const [id, phrases] of Object.entries(L.SECTOR_TERMS)) {
  for (const p of phrases) { const k = normalize(p); if (!SECTOR_PHRASE.has(k)) SECTOR_PHRASE.set(k, id); }
}
const DAY_UNIT_SET = new Set(L.DAY_UNITS.map(normalize));

/** Greedy longest-match tokenizer over the phrase index. */
function scan(tokens) {
  const found = []; const rest = [];
  for (let i = 0; i < tokens.length;) {
    let hit = null;
    for (let len = Math.min(INDEX.maxLen, tokens.length - i); len >= 1; len--) {
      const entry = INDEX.map.get(tokens.slice(i, i + len).join(' '));
      if (entry) { hit = { ...entry, len, text: tokens.slice(i, i + len).join(' ') }; break; }
    }
    if (hit) { found.push(hit); i += hit.len; } else { rest.push(tokens[i]); i += 1; }
  }
  return { found, rest };
}

let callSeq = 0;
const call = (name, input) => ({ id: `r${++callSeq}`, name, input });

/**
 * @param {string} text user utterance
 * @param {{places: {findInText(text: string): Promise<object|null>}, now?: number, view?: {country?: string}}} deps
 * @returns {Promise<{confidence: 'high'|'low'|'none', toolCalls: Array<{id: string, name: string, input: object}>, replyKey: string, replyParams: object}>}
 */
export async function parseCommand(text, { places, now = Date.now(), view = {} }) {
  const raw = String(text ?? '');
  const norm = normalize(raw);
  const tokens = norm.split(' ').filter(Boolean);
  if (!tokens.length) return { confidence: 'none', toolCalls: [], replyKey: 'nlp.not_understood', replyParams: {} };

  const { found, rest } = scan(tokens);
  const has = (kind) => found.some((f) => f.kind === kind);
  const all = (kind) => found.filter((f) => f.kind === kind);
  const today = formatDate(new Date(now));

  const layers = [...new Set(all('layer').map((f) => f.value))];
  const sectors = [...new Set([
    ...all('sector').map((f) => f.value),
    ...found.filter((f) => f.kind === 'layer' && f.value === 'emissions').map((f) => SECTOR_PHRASE.get(f.text)).filter(Boolean),
  ])];
  const hide = has('hide'); const show = has('show'); const goto = has('goto');
  const clear = has('clear'); const annotate = has('annotate');
  const climateq = has('climateq'); const question = has('question');
  const toolCalls = []; let replyKey = 'nlp.not_understood'; let replyParams = {};

  // ── help ──
  if (has('help') && !layers.length && !has('lang')) {
    return { confidence: 'high', toolCalls, replyKey: 'nlp.help', replyParams };
  }

  // ── language switch ──
  const langs = all('lang');
  if (langs.length && (has('langword') || tokens.length <= 3 || show || goto)) {
    toolCalls.push(call('set_language', { language: langs[0].value }));
    return { confidence: 'high', toolCalls, replyKey: 'nlp.language_set', replyParams: { language: langs[0].value } };
  }

  // ── date ──
  let dateAction = null;
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(raw);
  const nDays = (() => {
    for (let i = 0; i < tokens.length - 1; i++) if (/^\d{1,4}$/.test(tokens[i]) && DAY_UNIT_SET.has(tokens[i + 1])) return Number(tokens[i]);
    return null;
  })();
  if (iso && isValidDate(iso[0])) dateAction = iso[0];
  else if (nDays !== null && nDays <= 3650) dateAction = addDays(today, -nDays);
  else if (has('date')) dateAction = addDays(today, -all('date')[0].value);

  // ── clearing ──
  const wantsClearAnnotations = (clear || hide) && has('annNoun');
  const wantsClearLayers = (clear || hide) && has('all') && !layers.length;
  if (wantsClearAnnotations) toolCalls.push(call('clear_annotations', {}));
  if (wantsClearLayers) toolCalls.push(call('set_layers', { layers: [], mode: 'replace' }));
  if (toolCalls.length) return { confidence: 'high', toolCalls, replyKey: 'nlp.cleared', replyParams: {} };

  // ── place (tokens not consumed by command vocabulary) ──
  const place = await places.findInText(rest.join(' '));
  const placeName = place?.name ?? null;

  // ── climate comparison ("how hot is Kano vs normal") ──
  if (climateq && place) {
    toolCalls.push(call('open_climate_card', { place: placeName }));
    toolCalls.push(call('get_climate_summary', { place: placeName }));
    return { confidence: 'high', toolCalls, replyKey: 'nlp.climate_result', replyParams: { place: placeName } };
  }

  // ── emissions ──
  const wantsEmissions = layers.includes('emissions');
  if (wantsEmissions && !hide) {
    const country = place?.type === 'country' ? place.country : place?.country ?? view.country ?? 'NGA';
    toolCalls.push(call('show_emissions', { country, sector: sectors[0] ?? 'all' }));
    if (place) toolCalls.push(call('fly_to', { place: placeName }));
    const rest2 = layers.filter((l) => l !== 'emissions');
    if (rest2.length) toolCalls.push(call('set_layers', { layers: rest2, mode: 'add' }));
    replyKey = 'nlp.emissions'; replyParams = { country, sector: sectors[0] ?? 'all' };
  } else if (layers.length && !has('annNoun')) {
    // ── layers on/off ──
    toolCalls.push(call('set_layers', { layers, mode: hide ? 'remove' : 'add' }));
    replyKey = hide ? 'nlp.layers_off' : 'nlp.layers_on';
    replyParams = { layers };
    if (place && !hide) { toolCalls.push(call('fly_to', { place: placeName })); replyKey = 'nlp.layers_and_place'; replyParams = { layers, place: placeName }; }
  }

  // ── annotate ──
  if (annotate && place && !toolCalls.length) {
    const kindPhrase = all('annotate').map((f) => ANNOTATE_KIND.get(f.text)).find(Boolean);
    const input = { place: placeName, kind: kindPhrase ?? 'marker' };
    const km = /(\d{1,4})\s?(?:km|kilometers?|kilometres?)\b/.exec(norm);
    if (km) { input.kind = 'circle'; input.radius_km = Number(km[1]); }
    toolCalls.push(call('annotate', input));
    replyKey = 'nlp.annotated'; replyParams = { place: placeName };
  }

  // ── fly to a place ──
  if (place && !toolCalls.some((c) => ['fly_to', 'annotate', 'show_emissions'].includes(c.name)) && !hide && !layers.length) {
    toolCalls.push(call('fly_to', { place: placeName }));
    replyKey = 'nlp.flying'; replyParams = { place: placeName };
  }

  // ── date (can accompany anything, or stand alone) ──
  if (dateAction) {
    toolCalls.push(call('set_date', { date: dateAction }));
    if (replyKey === 'nlp.not_understood') { replyKey = 'nlp.date_set'; replyParams = { date: dateAction }; }
  }

  if (!toolCalls.length) return { confidence: 'none', toolCalls, replyKey: 'nlp.not_understood', replyParams: {} };

  // A genuine question, or a long sentence we only partly understood, is better answered by an LLM.
  const placeTokens = place ? normalize(placeName).split(' ').length : 0;
  const unmatched = Math.max(0, rest.length - placeTokens);
  const confidence = (question || unmatched > 8) ? 'low' : 'high';
  return { confidence, toolCalls, replyKey, replyParams };
}
