// Place lookup over shared/gazetteer.json (Natural Earth, public domain).
// Pure: callers pass the parsed JSON, so the same code runs in Node and the
// browser. Powers fly-to, annotations, NLP place grounding and click labels.

const EARTH_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;

export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1); const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** lowercase, strip diacritics/punctuation, collapse spaces. Unicode-aware (Arabic etc.). */
export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const STATE_WORDS = new Set(['state', 'province', 'region', 'district', 'governorate', 'county', 'etat', 'etat de', 'province de']);
const CITY_WORDS = new Set(['city', 'town', 'ville']);
const PREFIX_FILLER = /^(the|le|la|les|l|el|al|a|an) /;

// Common alternative / local-language country names that Natural Earth lacks.
const COUNTRY_ALIASES = {
  CIV: ['ivory coast', 'cote d ivoire'],
  COD: ['dr congo', 'drc', 'congo kinshasa', 'democratic republic of congo', 'democratic republic of the congo'],
  COG: ['congo brazzaville', 'republic of congo', 'republic of the congo'],
  CPV: ['cape verde', 'cabo verde'],
  SWZ: ['swaziland', 'eswatini'],
  STP: ['sao tome', 'sao tome and principe'],
  GMB: ['gambia', 'the gambia'],
  TZA: ['tanzania'],
  NGA: ['najeriya', 'naijiria', 'nigerie'],
  EGY: ['misr', 'egypte'],
  ETH: ['ethiopie'],
  SEN: ['senegal'],
};

/** Suggested camera altitude (km) so the entity fills a comfortable view. */
function altitudeKm(entity) {
  if (entity.type === 'country') {
    const [w, s, e, n] = entity.bbox;
    const diag = haversineKm(s, w, n, e < w ? e + 360 : e);
    return Math.min(7000, Math.max(300, Math.round(diag * 1.3)));
  }
  if (entity.type === 'admin1') return 260;
  if (entity.type === 'landmark') return 90;
  return entity.pop > 1_000_000 ? 120 : 70;
}

const TYPE_RANK = { country: 0, admin1: 1, place: 2, landmark: 2 };

/**
 * @param {object} data parsed shared/gazetteer.json
 */
export function createGazetteer(data) {
  /** @type {Map<string, object[]>} */
  const index = new Map();
  const entities = [];
  const add = (key, entity) => {
    const k = normalize(key);
    if (!k || k.length < 2) return;
    const list = index.get(k);
    if (!list) index.set(k, [entity]);
    else if (!list.includes(entity)) list.push(entity);
  };

  const countryByIso = new Map();
  for (const c of data.countries) {
    const [w, s, e, n] = c.bbox;
    const entity = {
      type: 'country', id: `country:${c.iso3}`, name: c.name, country: c.iso3, continent: c.continent,
      bbox: c.bbox, lat: (s + n) / 2, lon: (w + e) / 2, pop: 0, names: c.names,
    };
    entity.altKm = altitudeKm(entity);
    countryByIso.set(c.iso3, entity);
    entities.push(entity);
    for (const k of [c.name, ...(c.alt || []), ...Object.values(c.names || {}), ...(COUNTRY_ALIASES[c.iso3] || [])]) add(k, entity);
  }

  for (const a of data.admin1) {
    const entity = { type: 'admin1', id: `admin1:${a.country}:${a.name}`, name: a.name, country: a.country, lat: a.lat, lon: a.lon, pop: a.pop || 0 };
    entity.altKm = altitudeKm(entity);
    entities.push(entity);
    for (const k of [a.name, ...(a.alt || [])]) add(k, entity);
  }

  for (const p of data.places) {
    const entity = { type: 'place', id: `place:${p.country}:${p.name}`, name: p.name, country: p.country, admin1: p.admin1, lat: p.lat, lon: p.lon, pop: p.pop || 0, cap: p.cap || 0 };
    entity.altKm = altitudeKm(entity);
    entities.push(entity);
    for (const k of [p.name, p.ascii, ...(p.alt || [])]) add(k, entity);
  }

  for (const l of data.landmarks || []) {
    const entity = { type: 'landmark', id: `landmark:${l.name}`, name: l.name, country: l.country, lat: l.lat, lon: l.lon, pop: 0 };
    entity.altKm = altitudeKm(entity);
    entities.push(entity);
    add(l.name, entity);
  }

  const score = (e, hint) => {
    let s = TYPE_RANK[e.type] * 1000;
    if (hint === 'state') s += e.type === 'admin1' ? -1500 : 0;
    if (hint === 'city') s += e.type === 'place' ? -1500 : 0;
    if (e.type === 'place') s += e.cap === 2 ? -300 : e.cap === 1 ? -150 : 0;
    s -= Math.min(299, Math.log10((e.pop || 0) + 1) * 40);
    return s;
  };

  function pick(list, hint) {
    return list.slice().sort((a, b) => score(a, hint) - score(b, hint))[0];
  }

  /** Strip hint words/prefixes; returns {key, hint}. */
  function prepare(query) {
    let q = normalize(query);
    let hint = null;
    const toks = q.split(' ');
    if (toks.length > 1 && STATE_WORDS.has(toks[toks.length - 1])) { hint = 'state'; toks.pop(); }
    else if (toks.length > 1 && CITY_WORDS.has(toks[toks.length - 1])) { hint = 'city'; toks.pop(); }
    q = toks.join(' ');
    return { q, hint };
  }

  /** Find one place by name. Returns an entity or null. */
  function find(query, { country = null } = {}) {
    const { q, hint } = prepare(query);
    if (!q) return null;
    for (const key of [q, q.replace(PREFIX_FILLER, '')]) {
      let list = index.get(key);
      if (!list) continue;
      if (country) list = list.filter((e) => e.country === country).length ? list.filter((e) => e.country === country) : list;
      return pick(list, hint);
    }
    return null;
  }

  /** Find the longest place mention inside free text. Returns {entity, span, start} or null. */
  function findInTextDetailed(text) {
    const toks = normalize(text).split(' ').filter(Boolean);
    let best = null;
    for (let i = 0; i < toks.length; i++) {
      for (let len = Math.min(4, toks.length - i); len >= 1; len--) {
        const phrase = toks.slice(i, i + len);
        if (len === 1 && phrase[0].length < 3) continue;
        let hint = null;
        let words = phrase;
        const last = words[words.length - 1];
        if (words.length > 1 && STATE_WORDS.has(last)) { hint = 'state'; words = words.slice(0, -1); }
        else if (words.length > 1 && CITY_WORDS.has(last)) { hint = 'city'; words = words.slice(0, -1); }
        const list = index.get(words.join(' '));
        if (!list) continue;
        const entity = pick(list, hint);
        const span = phrase.length;
        if (!best || span > best.span || (span === best.span && score(entity, hint) < score(best.entity, best.hint))) best = { entity, span, hint, start: i };
        break; // longest match at this start index found
      }
    }
    return best ? { entity: best.entity, span: best.span, start: best.start } : null;
  }

  /** Find the longest place mention inside free text (for offline NLP). */
  function findInText(text) {
    return findInTextDetailed(text)?.entity ?? null;
  }

  /** Nearest known settlement to a coordinate, with distance. */
  function nearest(lat, lon, { maxKm = 400 } = {}) {
    let best = null; let bestD = Infinity;
    for (const e of entities) {
      if (e.type !== 'place') continue;
      const d = haversineKm(lat, lon, e.lat, e.lon);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best || bestD > maxKm) return null;
    return { place: best, km: bestD, country: countryByIso.get(best.country) || null };
  }

  /** Which country (bbox hit) contains a coordinate, preferring the one with the nearest capital. */
  function countryAt(lat, lon) {
    const near = nearest(lat, lon, { maxKm: 1500 });
    if (near) {
      const c = countryByIso.get(near.place.country);
      if (c) return c;
    }
    return null;
  }

  return {
    find, findInText, findInTextDetailed, nearest, countryAt,
    country: (iso3) => countryByIso.get(iso3) || null,
    countries: () => [...countryByIso.values()],
    entities: () => entities,
  };
}
