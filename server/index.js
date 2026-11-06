#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

export { createApp };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, cfg, nlpProvider } = createApp();
  server.listen(cfg.port, cfg.host, () => {
    const where = `http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}`;
    console.log(`Transcend Climate server v${cfg.version} listening on ${cfg.host}:${cfg.port}  (${where})`);
    console.log(`  NLP:       ${nlpProvider.name}${nlpProvider.reason ? ` — ${nlpProvider.reason}` : ''}${nlpProvider.name === 'offline' ? '  (rule parser only; set ANTHROPIC_API_KEY etc. for LLM understanding)' : ''}`);
    console.log(`  Air quality (OpenAQ): ${cfg.openaqKey ? 'enabled' : 'disabled (set OPENAQ_API_KEY)'}`);
    console.log(`  Geocoder:  ${cfg.geocoder.mode}${cfg.geocoder.mode === 'nominatim' && cfg.geocoder.userAgent.includes('set GEOCODER_USER_AGENT') ? '  ⚠ set GEOCODER_USER_AGENT to identify your deployment (OSM policy)' : ''}`);
    if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') console.log('  ⚠ listening beyond loopback: put TLS in front, set ALLOWED_HOSTS, and see SECURITY.md');
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
