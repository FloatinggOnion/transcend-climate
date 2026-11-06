// POST /api/nlp/chat orchestrator.
//
//   user text ──► rule parser (free, instant) ── high confidence ──► actions
//                      │ low / none
//                      ▼
//                 LLM tool loop (if a provider is configured and budget remains)
//                      │ unavailable / refused / over budget
//                      ▼
//                 best-effort rule result, or a "didn't understand" key
//
// Whatever proposes an action (rules or model), it is resolved and validated
// here before the browser ever sees it, and the browser validates it again.

import { ALL_TOOLS, CLIENT_TOOL_NAMES, SERVER_TOOL_NAMES, validateClientAction } from '../../shared/actions.js';
import { LAYER_IDS, addDays, formatDate, isValidDate } from '../../shared/catalog.js';
import { LANGUAGE_CODES, getLanguage } from '../../shared/languages.js';
import { HttpError } from '../http.js';
import { parseCommand } from './rules.js';
import { SYSTEM_PROMPT, mapStateBlock } from './prompt.js';
import { NlpProviderError } from './providerError.js';

const MAX_HISTORY = 8;
const MAX_LLM_ITERATIONS = 4;
const MAX_ACTIONS = 8;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const ISO3 = /^[A-Z]{3}$/;
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

export function sanitizeRequest(body, cfg, nowMs) {
  const max = cfg.nlp.maxMessageChars;
  if (!body || !Array.isArray(body.messages) || !body.messages.length) throw new HttpError(400, 'bad_request', 'messages must be a non-empty array');
  const messages = body.messages.slice(-MAX_HISTORY).map((m) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') throw new HttpError(400, 'bad_request', 'each message needs role user|assistant and string content');
    const content = m.content.replace(CONTROL_CHARS, ' ').trim();
    if (!content) throw new HttpError(400, 'bad_request', 'empty message');
    if (content.length > max) throw new HttpError(400, 'message_too_long', `messages are limited to ${max} characters`);
    return { role: m.role, content };
  });
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length || messages.at(-1).role !== 'user') throw new HttpError(400, 'bad_request', 'the last message must be from the user');

  const c = body.context && typeof body.context === 'object' ? body.context : {};
  const v = c.view && typeof c.view === 'object' ? c.view : {};
  const today = formatDate(new Date(nowMs));
  const context = {
    lang: LANGUAGE_CODES.includes(c.lang) ? c.lang : 'en',
    date: isValidDate(c.date) && c.date <= today ? c.date : null,
    layers: Array.isArray(c.layers) ? [...new Set(c.layers.filter((id) => LAYER_IDS.includes(id)))].slice(0, LAYER_IDS.length) : [],
    view: {
      lat: num(v.lat, -90, 90), lon: num(v.lon, -180, 180), altKm: num(v.altKm, 0, 60000),
      country: typeof v.country === 'string' && ISO3.test(v.country) ? v.country : null,
    },
    emissions: c.emissions && ISO3.test(c.emissions.country) ? { country: c.emissions.country, sector: String(c.emissions.sector || 'all').slice(0, 30) } : null,
  };
  return { messages, context };
}

export function createChatService({ cfg, provider, providerName, places, gazetteer, services, budget, now = () => Date.now(), log = () => {} }) {
  const today = () => formatDate(new Date(now()));

  /** Resolve a country name or ISO-3 code to an ISO-3 code the gazetteer knows. */
  async function resolveCountry(input) {
    const s = String(input ?? '').trim();
    if (!s) return null;
    if (/^[A-Za-z]{3}$/.test(s) && gazetteer.country(s.toUpperCase())) return s.toUpperCase();
    const p = await places.resolve(s, { remote: false });
    if (!p) return null;
    if (p.type === 'country') return gazetteer.find(s)?.country ?? p.country;
    return p.country && gazetteer.country(p.country) ? p.country : null;
  }

  /** A tool call → a validated client action, or an error string the model can react to. */
  async function toClientAction(name, input) {
    const need = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    switch (name) {
      case 'fly_to': {
        const q = need(input.place); if (!q) return { error: 'place is required' };
        const p = await places.resolve(q); if (!p) return { error: `could not find a place called "${q}"` };
        const altKm = num(input.altitude_km, 10, 15000) ?? p.altKm;
        return finish({ type: 'fly_to', lat: p.lat, lon: p.lon, altKm, label: p.name });
      }
      case 'open_climate_card': {
        const q = need(input.place); if (!q) return { error: 'place is required' };
        const p = await places.resolve(q); if (!p) return { error: `could not find a place called "${q}"` };
        return finish({ type: 'open_climate_card', lat: p.lat, lon: p.lon, label: p.name });
      }
      case 'annotate': {
        const q = need(input.place); if (!q) return { error: 'place is required' };
        const p = await places.resolve(q); if (!p) return { error: `could not find a place called "${q}"` };
        const kind = ['marker', 'circle', 'outline'].includes(input.kind) ? input.kind : 'marker';
        return finish({ type: 'annotate', kind, lat: p.lat, lon: p.lon, place: p.name, label: need(input.label) ?? p.name, radiusKm: kind === 'circle' ? (num(input.radius_km, 1, 3000) ?? 25) : null });
      }
      case 'set_layers': return finish({ type: 'set_layers', layers: Array.isArray(input.layers) ? input.layers : [], mode: input.mode });
      case 'set_date': {
        const date = isValidDate(input.date) ? input.date : (Number.isInteger(input.days_ago) ? addDays(today(), -input.days_ago) : null);
        if (!date) return { error: 'give a valid date (YYYY-MM-DD) or days_ago' };
        return finish({ type: 'set_date', date: date > today() ? today() : date });
      }
      case 'set_basemap': return finish({ type: 'set_basemap', basemap: input.basemap });
      case 'clear_annotations': return finish({ type: 'clear_annotations' });
      case 'set_language': return finish({ type: 'set_language', language: input.language });
      case 'show_emissions': {
        const country = await resolveCountry(input.country); if (!country) return { error: `could not identify the country "${input.country}"` };
        return finish({ type: 'show_emissions', country, sector: input.sector || 'all' });
      }
      default: return { error: `unknown tool ${name}` };
    }
  }
  function finish(action) {
    const valid = validateClientAction(action);
    return valid ? { action: valid } : { error: 'arguments rejected by validation' };
  }

  /** Server-run tools: fetch real data for the model to quote. Returns {content, data}. */
  async function runServerTool(name, input) {
    if (name === 'get_climate_summary') {
      const q = typeof input.place === 'string' ? input.place.trim() : '';
      const p = q && await places.resolve(q);
      if (!p) return { error: `could not find a place called "${q}"` };
      const s = await services.climateSummary(p.lat, p.lon);
      if (!s.latest) return { error: 'no recent data available for that location' };
      const data = {
        place: p.name, month: s.latest.month, temperature_c: s.latest.tempC, normal_temperature_c: s.latest.tempNormalC, temperature_anomaly_c: s.latest.tempAnomalyC,
        rain_mm_per_day: s.latest.precipMmDay, normal_rain_mm_per_day: s.latest.precipNormalMmDay, rain_anomaly_percent: s.latest.precipAnomalyPct,
        baseline: s.baseline, recent_months: s.series.slice(-4).map((r) => ({ month: r.month, temperature_anomaly_c: r.tempAnomalyC, rain_anomaly_percent: r.precipAnomalyPct })),
        source: s.source, note: 'monthly means from reanalysis; latest complete month; 0.5° grid cell',
      };
      return { content: JSON.stringify(data), data };
    }
    if (name === 'get_emissions_summary') {
      const country = await resolveCountry(input.country); if (!country) return { error: `could not identify the country "${input.country}"` };
      const { body } = await services.emissions({ country, sector: input.sector || 'all', limit: 10 });
      const data = {
        country, year: body.year, sector: body.sector, total_mt_co2e_top_facilities: Math.round(body.totalCo2e / 1e4) / 100,
        top_facilities: body.facilities.slice(0, 8).map((f) => ({ name: f.name, sector: f.sector, mt_co2e: Math.round(f.co2e / 1e4) / 100, owners: f.owners })),
        source: 'Climate TRACE', note: 'modelled estimates, tonnes CO2e (100-yr GWP)',
      };
      return { content: JSON.stringify(data), data };
    }
    return { error: `unknown tool ${name}` };
  }

  /** Execute tool calls from either source. Collects validated actions + results for the model. */
  async function executeCalls(toolCalls, acc) {
    const results = [];
    for (const c of toolCalls) {
      const input = c.input && typeof c.input === 'object' && !c.input.__invalid ? c.input : null;
      let r;
      try {
        if (!input) r = { error: 'invalid arguments (not valid JSON)' };
        else if (CLIENT_TOOL_NAMES.has(c.name)) {
          r = await toClientAction(c.name, input);
          if (r.action) { if (acc.actions.length < MAX_ACTIONS) acc.actions.push(r.action); r = { content: 'done' }; }
        } else if (SERVER_TOOL_NAMES.has(c.name)) {
          r = await runServerTool(c.name, input);
          if (r.data) acc.data[c.name] = r.data;
        } else r = { error: `unknown tool ${c.name}` };
      } catch (err) {
        log('tool-error', c.name, err?.message);
        r = { error: err instanceof HttpError && err.status < 500 ? err.message : 'that lookup is temporarily unavailable' };
      }
      results.push({ id: c.id, name: c.name, content: r.error ? `Error: ${r.error}` : r.content, isError: !!r.error });
    }
    return results;
  }

  /** Params for localized rule replies, enriched with fetched data. */
  function replyParamsFor(key, params, acc) {
    if (key === 'nlp.climate_result') {
      const d = acc.data.get_climate_summary;
      if (!d) return { key: 'nlp.climate_unavailable', params };
      return { key, params: { place: d.place, month: d.month, tempAnomalyC: d.temperature_anomaly_c, tempC: d.temperature_c, precipAnomalyPct: d.rain_anomaly_percent, precipMmDay: d.rain_mm_per_day } };
    }
    return { key, params };
  }

  async function viaRules(rules) {
    const acc = { actions: [], data: {} };
    const results = await executeCalls(rules.toolCalls, acc);
    const failed = results.filter((r) => r.isError);
    if (!acc.actions.length && failed.length) {
      return { acc, key: 'nlp.place_not_found', params: { detail: failed[0].content.replace(/^Error: /, '') } };
    }
    const r = replyParamsFor(rules.replyKey, rules.replyParams, acc);
    return { acc, key: r.key, params: r.params };
  }

  const out = (o) => ({ mode: 'rules', provider: null, reply: null, replyKey: null, replyParams: {}, actions: [], notice: null, ...o });

  /** The LLM tool loop. Returns null if nothing usable came back. */
  async function viaLlm({ messages, context, signal }) {
    const acc = { actions: [], data: {} };
    const convo = messages.map((m) => ({ ...m }));
    const last = convo.at(-1);
    last.content = `${mapStateBlock(context)}\n\n${last.content}`;
    const lang = getLanguage(context.lang);
    const system = `${SYSTEM_PROMPT}\n\nThe user's interface language is ${lang?.name ?? 'English'} (${context.lang}).`;
    // NOTE: the language line is appended AFTER the stable block; it changes at most 8 ways.

    let text = '';
    for (let i = 0; i < MAX_LLM_ITERATIONS; i++) {
      if (!budget.take()) return { notice: 'budget_exhausted', acc, text };
      const res = await provider.complete({ system, messages: convo, tools: ALL_TOOLS, maxTokens: cfg.nlp.maxOutputTokens, signal });
      if (res.refused) return { notice: 'refused', acc, text: '' };
      text = res.text;
      if (!res.toolCalls.length) break;
      const results = await executeCalls(res.toolCalls, acc);
      convo.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls, raw: res.raw });
      convo.push({ role: 'tool', results });
      if (res.stopReason === 'max_tokens') break;
    }
    return { notice: null, acc, text };
  }

  return {
    /**
     * @param {unknown} body request JSON
     * @param {{signal?: AbortSignal}} [opts]
     */
    async handle(body, { signal } = {}) {
      const { messages, context } = sanitizeRequest(body, cfg, now());
      const userText = messages.at(-1).content;
      const rules = await parseCommand(userText, { places, now: now(), view: context.view });

      // Fast path: confident, simple command. No model call, no cost.
      if (rules.confidence === 'high' || !provider) {
        if (rules.confidence === 'none' || (!provider && !rules.toolCalls.length)) {
          return out({ mode: provider ? 'rules' : 'offline', replyKey: 'nlp.not_understood', notice: provider ? null : 'offline' });
        }
        const r = await viaRules(rules);
        return out({ mode: provider ? 'rules' : 'offline', actions: r.acc.actions, replyKey: r.key, replyParams: r.params, notice: provider ? null : 'offline' });
      }

      // LLM path.
      let llm;
      try {
        llm = await viaLlm({ messages, context, signal: signal ?? AbortSignal.timeout(90_000) });
      } catch (err) {
        const code = err instanceof NlpProviderError ? err.code : 'unknown';
        log('llm-error', providerName, code, err?.message);
        const notice = code === 'auth' || code === 'bad_request' ? 'llm_misconfigured' : code === 'rate_limited' ? 'llm_rate_limited' : 'llm_unavailable';
        if (rules.toolCalls.length) { const r = await viaRules(rules); return out({ mode: 'offline', actions: r.acc.actions, replyKey: r.key, replyParams: r.params, notice }); }
        return out({ mode: 'offline', replyKey: 'nlp.llm_unavailable', notice });
      }
      if (llm.notice === 'refused') return out({ mode: 'llm', provider: providerName, replyKey: 'nlp.refused', notice: 'refused' });
      if (llm.notice === 'budget_exhausted') {
        if (rules.toolCalls.length) { const r = await viaRules(rules); return out({ mode: 'rules', actions: r.acc.actions, replyKey: r.key, replyParams: r.params, notice: 'budget_exhausted' }); }
        return out({ mode: 'rules', replyKey: 'nlp.budget_exhausted', notice: 'budget_exhausted' });
      }
      const reply = llm.text.replace(CONTROL_CHARS, ' ').slice(0, 1200).trim();
      return out({
        mode: 'llm', provider: providerName, reply: reply || null, actions: llm.acc.actions,
        replyKey: reply ? null : (llm.acc.actions.length ? 'nlp.done' : 'nlp.not_understood'),
      });
    },
  };
}
