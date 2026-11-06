import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, resolveNlpProvider } from './config.js';
import { createCache } from './cache.js';
import { createSafeFetch, UpstreamError } from './safeFetch.js';
import { createRateLimiter, createDailyBudget } from './rateLimit.js';
import { HttpError, clientIp, createRouter, hostAllowed, securityHeaders, sendJson, serveStatic } from './http.js';
import { createGazetteer } from '../shared/gazetteer.js';
import { createPlaceResolver } from './places.js';
import { createProvider } from './nlp/providers/index.js';
import { createChatService } from './nlp/chat.js';
import { registerMiscRoutes } from './routes/misc.js';
import { registerGibsRoutes } from './routes/gibs.js';
import { registerClimateRoutes } from './routes/climate.js';
import { registerEmissionsRoutes } from './routes/emissions.js';
import { registerAirQualityRoutes } from './routes/airquality.js';
import { registerGeocodeRoutes } from './routes/geocode.js';
import { registerNlpRoutes } from './routes/nlp.js';

/**
 * Build the HTTP server. Dependencies can be injected for tests.
 * @param {object} [opts]
 * @param {Record<string,string|undefined>} [opts.env]
 * @param {typeof fetch} [opts.fetchImpl] outbound fetch (tests stub the network)
 * @param {object} [opts.provider] pre-built NLP provider (tests)
 * @param {() => number} [opts.now]
 * @param {boolean} [opts.quiet]
 */
export function createApp({ env = process.env, fetchImpl, provider: injectedProvider, now = () => Date.now(), quiet = false } = {}) {
  const cfg = loadConfig(env);
  const log = (...a) => { if (!quiet) console.log(...a); };

  const safeFetch = createSafeFetch({ fetchImpl: fetchImpl ?? globalThis.fetch, userAgent: cfg.geocoder.userAgent });
  const gazetteer = createGazetteer(JSON.parse(readFileSync(new URL('../shared/gazetteer.json', import.meta.url), 'utf8')));
  const limiters = {
    api: createRateLimiter({ max: cfg.limits.apiPerMin, now }),
    nlp: createRateLimiter({ max: cfg.limits.nlpPerMin, now }),
  };

  /** @type {any} */
  const ctx = {
    cfg, now, safeFetch, gazetteer, limiters, log,
    cache: createCache({ dir: resolve(cfg.cacheDir), now }),
    services: {},
    geocodeRemote: null,
  };
  ctx.places = createPlaceResolver({ gazetteer, getRemote: () => ctx.geocodeRemote });

  const built = injectedProvider ? { provider: injectedProvider, name: injectedProvider.name } : createProvider(cfg, { safeFetch });
  ctx.chat = createChatService({
    cfg, provider: built.provider, providerName: built.name, places: ctx.places, gazetteer,
    services: ctx.services, budget: createDailyBudget({ limit: cfg.nlp.dailyBudget, now }), now, log: (...a) => log('[nlp]', ...a),
  });

  const router = createRouter();
  const reg = { router, ctx };
  registerMiscRoutes(reg);
  registerGibsRoutes(reg);
  registerClimateRoutes(reg);
  registerEmissionsRoutes(reg);
  registerAirQualityRoutes(reg);
  registerGeocodeRoutes(reg);
  registerNlpRoutes(reg);

  const staticRoot = resolve(cfg.staticDir);
  const secHeaders = securityHeaders(cfg);

  function errorBody(err) {
    if (err instanceof HttpError) return { status: err.status, body: { error: { code: err.code, message: err.message } } };
    if (err instanceof UpstreamError) {
      const status = err.code === 'timeout' ? 504 : err.code === 'blocked' ? 500 : 502;
      return { status, body: { error: { code: `upstream_${err.code}`, message: err.code === 'blocked' ? 'internal error' : 'an upstream data service failed' } } };
    }
    return { status: 500, body: { error: { code: 'internal_error', message: 'internal error' } } };
  }

  const server = createServer(async (req, res) => {
    const started = Date.now();
    let status = 200;
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = (code, ...rest) => { status = code; return origWriteHead(code, ...rest); };
    res.on('finish', () => log(`${req.method} ${(req.url || '').split('?')[0]} ${status} ${Date.now() - started}ms`));

    try {
      if (!hostAllowed(req, cfg)) { sendJson(res, 421, { error: { code: 'bad_host', message: 'unexpected Host header' } }, secHeaders); return; }
      const url = new URL(req.url, 'http://local');
      const cors = {};
      const origin = req.headers.origin;
      if (origin && cfg.corsOrigins.includes(origin)) {
        cors['access-control-allow-origin'] = origin; cors.vary = 'Origin';
        cors['access-control-allow-headers'] = 'content-type'; cors['access-control-allow-methods'] = 'GET, POST, OPTIONS';
      }
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...secHeaders, ...cors }); res.end(); return; }

      if (url.pathname.startsWith('/api/')) {
        const ip = clientIp(req, cfg.trustProxy, cfg.trustProxyHops);
        const general = limiters.api.take(ip);
        if (!general.allowed) throw Object.assign(new HttpError(429, 'rate_limited', 'too many requests'), { retryAfter: general.retryAfterSec });
        const route = router.match(req.method === 'HEAD' ? 'GET' : req.method, url.pathname);
        if (!route) {
          if (router.hasPath(url.pathname)) throw new HttpError(405, 'method_not_allowed');
          throw new HttpError(404, 'not_found');
        }
        if (route.limiter) {
          const lim = route.limiter.take(ip);
          if (!lim.allowed) throw Object.assign(new HttpError(429, 'rate_limited', 'too many requests; slow down a little'), { retryAfter: lim.retryAfterSec });
        }
        const result = await route.handler({ req, url, ctx });
        sendJson(res, result.status ?? 200, result.body, { ...secHeaders, ...cors, ...(result.headers ?? {}) });
        return;
      }

      if (!serveStatic(req, res, staticRoot, secHeaders)) {
        sendJson(res, 404, { error: { code: 'not_found', message: cfg.env === 'production' ? 'not found' : 'not found (has the frontend been built? run `pnpm build`)' } }, secHeaders);
      }
    } catch (err) {
      const { status: s, body } = errorBody(err);
      if (s >= 500) log('[error]', err?.stack || err);
      if (!res.headersSent) sendJson(res, s, body, { ...secHeaders, ...(err.retryAfter ? { 'retry-after': String(err.retryAfter) } : {}) });
      else res.end();
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 20_000;
  server.keepAliveTimeout = 5_000;

  return { server, cfg, ctx, nlpProvider: resolveNlpProvider(cfg) };
}
