import { resolveNlpProvider } from '../config.js';

export function registerMiscRoutes({ router, ctx }) {
  router.add('GET', '/api/health', async () => ({
    body: { ok: true, version: ctx.cfg.version, uptimeSec: Math.round(process.uptime()) },
    headers: { 'cache-control': 'no-store' },
  }));

  // Public runtime config for the browser. Includes the two client-side map
  // keys by design (Cesium/Google need them in the browser) — restrict those
  // by HTTP referrer at the provider. Server-side keys (OpenAQ, LLMs) never
  // appear here; only whether they are configured.
  router.add('GET', '/api/config', async () => {
    const provider = resolveNlpProvider(ctx.cfg);
    return {
      body: {
        version: ctx.cfg.version,
        terrain: ctx.cfg.terrain,
        features: {
          nlp: { provider: provider.name, mode: provider.name === 'offline' ? 'offline' : 'llm', note: provider.reason ?? null },
          openaq: !!ctx.cfg.openaqKey,
          geocoder: ctx.cfg.geocoder.mode !== 'off',
          googleMaps: !!ctx.cfg.googleMapsKey,
          cesiumIon: !!ctx.cfg.cesiumIonToken,
        },
        keys: {
          ...(ctx.cfg.googleMapsKey ? { googleMapsKey: ctx.cfg.googleMapsKey } : {}),
          ...(ctx.cfg.cesiumIonToken ? { cesiumIonToken: ctx.cfg.cesiumIonToken } : {}),
        },
        limits: { nlpMaxChars: ctx.cfg.nlp.maxMessageChars },
      },
      headers: { 'cache-control': 'no-store' },
    };
  });
}
