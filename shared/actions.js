// The contract between natural language and the app.
//
// An "action" is the only thing language can make the app do. The model (or the
// rule parser) proposes tool calls; the server resolves and validates them into
// plain action objects; the browser validates them AGAIN before executing. Model
// output is never trusted: every field is type-checked, range-checked and
// allow-listed on both sides, and nothing here can fetch a URL, run script, or
// touch anything outside the map state.

import { LAYER_IDS, BASEMAP_IDS, EMISSION_SECTORS, isValidDate } from './catalog.js';
import { LANGUAGE_CODES } from './languages.js';

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });

/** Tools whose effect happens in the user's browser. */
export const CLIENT_TOOLS = Object.freeze([
  {
    name: 'fly_to',
    description: 'Move the globe camera to a place (city, state, country, region, landmark). Pass the place name; the server resolves coordinates. Never invent coordinates.',
    input_schema: {
      type: 'object',
      properties: {
        place: str('Place name, e.g. "Lagos", "Kano State", "Lake Chad", "the Sahel", "Niger Delta".', { maxLength: 80 }),
        altitude_km: { type: 'number', description: 'Optional camera height in km (10–15000). Omit to auto-fit the place.', minimum: 10, maximum: 15000 },
      },
      required: ['place'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_layers',
    description: 'Turn data layers on/off. mode "add" turns the listed layers on and keeps others; "replace" shows only the listed layers; "remove" turns the listed layers off. Use layers [] with mode "replace" to hide everything.',
    input_schema: {
      type: 'object',
      properties: {
        layers: { type: 'array', items: { type: 'string', enum: LAYER_IDS }, maxItems: LAYER_IDS.length },
        mode: { type: 'string', enum: ['add', 'replace', 'remove'] },
      },
      required: ['layers', 'mode'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_date',
    description: 'Set the observation date for time-dependent satellite layers. Give an ISO date (YYYY-MM-DD) or days_ago (0 = latest available).',
    input_schema: {
      type: 'object',
      properties: {
        date: str('ISO date, YYYY-MM-DD', { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
        days_ago: { type: 'integer', minimum: 0, maximum: 3650 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'set_basemap',
    description: 'Change the base map imagery. blue-marble = static relief; true-color = daily satellite photo; bing-aerial/osm/photoreal need extra configuration and may be unavailable.',
    input_schema: { type: 'object', properties: { basemap: { type: 'string', enum: BASEMAP_IDS } }, required: ['basemap'], additionalProperties: false },
  },
  {
    name: 'annotate',
    description: 'Draw a labelled marker, circle, or region outline on the map.',
    input_schema: {
      type: 'object',
      properties: {
        place: str('Place to annotate.', { maxLength: 80 }),
        kind: { type: 'string', enum: ['marker', 'circle', 'outline'], description: '"outline" traces a natural region (e.g. the Sahel) when one is known; otherwise falls back to a circle.' },
        radius_km: { type: 'number', minimum: 1, maximum: 3000, description: 'Radius for kind "circle".' },
        label: str('Short label to display.', { maxLength: 60 }),
      },
      required: ['place'],
      additionalProperties: false,
    },
  },
  { name: 'clear_annotations', description: 'Remove all drawn annotations.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  {
    name: 'show_emissions',
    description: 'Show facility-level greenhouse-gas emissions (Climate TRACE) for a country, optionally one sector. Also turns the emissions layer on.',
    input_schema: {
      type: 'object',
      properties: {
        country: str('Country name or ISO-3 code, e.g. "Nigeria" or "NGA".', { maxLength: 60 }),
        sector: { type: 'string', enum: ['all', ...EMISSION_SECTORS] },
      },
      required: ['country'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_language',
    description: 'Switch the interface language.',
    input_schema: { type: 'object', properties: { language: { type: 'string', enum: LANGUAGE_CODES } }, required: ['language'], additionalProperties: false },
  },
  {
    name: 'open_climate_card',
    description: "Open the on-screen climate card (monthly temperature and rainfall vs normal) for a place. Use together with get_climate_summary when the user asks how conditions compare with normal.",
    input_schema: { type: 'object', properties: { place: str('Place name.', { maxLength: 80 }) }, required: ['place'], additionalProperties: false },
  },
]);

/** Tools the server runs itself and feeds back to the model. */
export const SERVER_TOOLS = Object.freeze([
  {
    name: 'get_climate_summary',
    description: 'Look up how recent monthly temperature and rainfall at a place compare with the 25-year normal (NASA POWER). ALWAYS call this before stating any temperature or rainfall figures; never guess numbers.',
    input_schema: { type: 'object', properties: { place: str('Place name.', { maxLength: 80 }) }, required: ['place'], additionalProperties: false },
  },
  {
    name: 'get_emissions_summary',
    description: 'Look up the largest greenhouse-gas emitting facilities in a country (Climate TRACE). ALWAYS call this before stating emissions figures.',
    input_schema: {
      type: 'object',
      properties: { country: str('Country name or ISO-3 code.', { maxLength: 60 }), sector: { type: 'string', enum: ['all', ...EMISSION_SECTORS] } },
      required: ['country'],
      additionalProperties: false,
    },
  },
]);

export const ALL_TOOLS = Object.freeze([...CLIENT_TOOLS, ...SERVER_TOOLS]);
export const CLIENT_TOOL_NAMES = new Set(CLIENT_TOOLS.map((t) => t.name));
export const SERVER_TOOL_NAMES = new Set(SERVER_TOOLS.map((t) => t.name));

// ───────────────────── final-shape validation (server AND browser) ─────────────────────

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;
const cleanText = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const ISO3 = /^[A-Z]{3}$/;

/**
 * Validate a *resolved* action object. Returns the sanitised action, or null.
 * Rebuilds the object from known fields only, so unexpected keys never survive.
 * @param {unknown} a
 */
export function validateClientAction(a) {
  if (!a || typeof a !== 'object') return null;
  switch (a.type) {
    case 'fly_to':
      if (!inRange(a.lat, -90, 90) || !inRange(a.lon, -180, 180) || !inRange(a.altKm, 5, 20000)) return null;
      return { type: 'fly_to', lat: a.lat, lon: a.lon, altKm: a.altKm, label: cleanText(a.label, 120) ? a.label : '' };
    case 'set_layers': {
      if (!Array.isArray(a.layers) || !['add', 'replace', 'remove'].includes(a.mode)) return null;
      if (!a.layers.every((id) => LAYER_IDS.includes(id))) return null;
      return { type: 'set_layers', layers: [...new Set(a.layers)], mode: a.mode };
    }
    case 'set_date': {
      if (!isValidDate(a.date) || a.date < '2000-01-01') return null;
      return { type: 'set_date', date: a.date };
    }
    case 'set_basemap':
      return BASEMAP_IDS.includes(a.basemap) ? { type: 'set_basemap', basemap: a.basemap } : null;
    case 'annotate': {
      if (!['marker', 'circle', 'outline'].includes(a.kind)) return null;
      if (!inRange(a.lat, -90, 90) || !inRange(a.lon, -180, 180)) return null;
      const radiusKm = a.radiusKm === undefined || a.radiusKm === null ? null : a.radiusKm;
      if (radiusKm !== null && !inRange(radiusKm, 1, 3000)) return null;
      return {
        type: 'annotate', kind: a.kind, lat: a.lat, lon: a.lon, radiusKm,
        place: cleanText(a.place, 120) ? a.place : '', label: cleanText(a.label, 60) ? a.label : '',
      };
    }
    case 'clear_annotations': return { type: 'clear_annotations' };
    case 'show_emissions':
      if (!ISO3.test(a.country) || !(a.sector === 'all' || EMISSION_SECTORS.includes(a.sector))) return null;
      return { type: 'show_emissions', country: a.country, sector: a.sector };
    case 'set_language':
      return LANGUAGE_CODES.includes(a.language) ? { type: 'set_language', language: a.language } : null;
    case 'open_climate_card':
      if (!inRange(a.lat, -90, 90) || !inRange(a.lon, -180, 180)) return null;
      return { type: 'open_climate_card', lat: a.lat, lon: a.lon, label: cleanText(a.label, 120) ? a.label : '' };
    default: return null;
  }
}
