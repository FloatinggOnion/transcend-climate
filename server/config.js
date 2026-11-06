// Environment → immutable config. Everything optional: with no env at all the
// server runs keyless (GIBS basemap + NASA POWER + Climate TRACE + offline NLP).

function int(env, name, dflt, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return dflt;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be an integer in [${min}, ${max}], got "${raw}"`);
  return n;
}
const str = (env, name, dflt = '') => (env[name] ?? dflt).toString().trim();
const list = (env, name) => str(env, name).split(',').map((s) => s.trim()).filter(Boolean);

/**
 * @param {Record<string,string|undefined>} env
 */
export function loadConfig(env = process.env) {
  const cfg = {
    version: '0.1.0',
    env: str(env, 'NODE_ENV', 'development'),
    host: str(env, 'HOST', '127.0.0.1'),
    port: int(env, 'PORT', 8787, { min: 0, max: 65535 }),
    // Reverse-proxy awareness. Only trust X-Forwarded-For if you actually sit behind one.
    trustProxy: str(env, 'TRUST_PROXY') === 'true',
    corsOrigins: list(env, 'CORS_ORIGINS'),
    // Hostnames the server answers to (DNS-rebinding guard). Empty = loopback only when bound to loopback.
    allowedHosts: list(env, 'ALLOWED_HOSTS'),
    cacheDir: str(env, 'CACHE_DIR', '.tc-cache'),
    staticDir: str(env, 'STATIC_DIR', 'dist'),

    // Client-exposed keys (restrict them by HTTP referrer at the provider!).
    googleMapsKey: str(env, 'GOOGLE_MAPS_API_KEY'),
    cesiumIonToken: str(env, 'CESIUM_ION_TOKEN'),
    terrain: str(env, 'TERRAIN', 'reearth') === 'flat' ? 'flat' : 'reearth',

    // Server-side-only keys.
    openaqKey: str(env, 'OPENAQ_API_KEY'),

    geocoder: {
      mode: str(env, 'GEOCODER', 'nominatim') === 'off' ? 'off' : 'nominatim',
      // Nominatim's usage policy requires an identifying User-Agent with contact info.
      userAgent: str(env, 'GEOCODER_USER_AGENT', 'TranscendClimate/0.1 (self-hosted; set GEOCODER_USER_AGENT)'),
    },

    nlp: {
      provider: str(env, 'NLP_PROVIDER', 'auto'), // auto|anthropic|openai|compatible|offline
      anthropicKey: str(env, 'ANTHROPIC_API_KEY'),
      // Cheaper options for this tool-routing workload: claude-sonnet-5-5, claude-haiku-5-5.
      anthropicModel: str(env, 'ANTHROPIC_MODEL', 'claude-opus-5-5'),
      // low = cheapest/fastest, plenty for routing user intents to tools. "off" omits the parameter
      // (required for models that don't support effort).
      anthropicEffort: str(env, 'ANTHROPIC_EFFORT', 'low'),
      // Server-side refusal fallback (Claude API only). "off" disables; auto-skipped for models that lack it.
      anthropicFallbacks: str(env, 'ANTHROPIC_FALLBACKS', 'default'),
      openaiKey: str(env, 'OPENAI_API_KEY'),
      openaiModel: str(env, 'OPENAI_MODEL'), // no default: model ids drift, so require an explicit choice
      // Any OpenAI-compatible endpoint: Ollama, vLLM, LM Studio, Together, Groq, …
      compatBaseUrl: str(env, 'NLP_BASE_URL'),
      compatKey: str(env, 'NLP_API_KEY'),
      compatModel: str(env, 'NLP_MODEL'),
      // Adaptive thinking tokens count toward this cap, so leave headroom above the visible reply.
      maxOutputTokens: int(env, 'NLP_MAX_OUTPUT_TOKENS', 4096, { min: 256, max: 16000 }),
      maxMessageChars: int(env, 'NLP_MAX_MESSAGE_CHARS', 800, { min: 50, max: 8000 }),
      // Hard daily ceiling on paid LLM calls across ALL users: protects against bill shock.
      // Simple commands are answered by the free rule parser first, so this goes a long way.
      dailyBudget: int(env, 'NLP_DAILY_REQUEST_BUDGET', 500, { min: 0 }),
    },

    limits: {
      apiPerMin: int(env, 'RATE_LIMIT_API_PER_MIN', 240, { min: 1 }),
      nlpPerMin: int(env, 'RATE_LIMIT_NLP_PER_MIN', 20, { min: 1 }),
    },
  };
  return Object.freeze(cfg);
}

/**
 * Pick the NLP backend. 'auto' prefers a configured hosted provider, then a
 * compatible endpoint, and always has the offline rule parser as a floor.
 * @returns {{name: 'anthropic'|'openai'|'compatible'|'offline', reason?: string}}
 */
export function resolveNlpProvider(cfg) {
  const n = cfg.nlp;
  const ready = {
    anthropic: !!n.anthropicKey,
    openai: !!n.openaiKey && !!n.openaiModel,
    compatible: !!n.compatBaseUrl && !!n.compatModel,
    offline: true,
  };
  if (n.provider !== 'auto') {
    if (!(n.provider in ready)) return { name: 'offline', reason: `unknown NLP_PROVIDER "${n.provider}"` };
    if (!ready[n.provider]) return { name: 'offline', reason: `NLP_PROVIDER=${n.provider} but its credentials/model are not set` };
    return { name: n.provider };
  }
  for (const name of ['anthropic', 'openai', 'compatible']) if (ready[name]) return { name };
  return { name: 'offline' };
}
