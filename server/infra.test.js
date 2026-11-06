import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSafeFetch, UpstreamError } from './safeFetch.js';
import { createCache } from './cache.js';
import { createRateLimiter, createDailyBudget } from './rateLimit.js';
import { safeResolve, buildCsp, hostAllowed } from './http.js';
import { loadConfig, resolveNlpProvider } from './config.js';

const res = (body, init = {}) => new Response(body, init);
const rejects = (p, code) => assert.rejects(p, (e) => e instanceof UpstreamError && e.code === code);

// ───────────── safeFetch ─────────────
test('safeFetch: only https, only allow-listed hosts, no credentials, no odd ports', async () => {
  const sf = createSafeFetch({ allowHosts: ['good.test'], fetchImpl: async () => res('ok') });
  assert.equal((await sf('https://good.test/x')).text(), 'ok');
  await rejects(sf('http://good.test/x'), 'blocked');
  await rejects(sf('https://evil.test/x'), 'blocked');
  await rejects(sf('https://user:pw@good.test/x'), 'blocked');
  await rejects(sf('https://good.test:8443/x'), 'blocked');
  await rejects(sf('https://good.test.evil.test/x'), 'blocked');
  await rejects(sf('https://127.0.0.1/x'), 'blocked');
  await rejects(sf('file:///etc/passwd'), 'blocked');
  await rejects(sf('not a url'), 'blocked');
});

test('safeFetch: redirects are re-validated on every hop', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/ok') return res('', { status: 302, headers: { location: '/final' } });
    if (u.pathname === '/final') return res('done');
    if (u.pathname === '/evil') return res('', { status: 302, headers: { location: 'https://evil.test/steal' } });
    if (u.pathname === '/loop') return res('', { status: 302, headers: { location: '/loop' } });
    return res('?', { status: 404 });
  };
  const sf = createSafeFetch({ allowHosts: ['good.test'], fetchImpl });
  assert.equal((await sf('https://good.test/ok')).text(), 'done');
  await rejects(sf('https://good.test/evil'), 'blocked');
  await rejects(sf('https://good.test/loop'), 'blocked');
});

test('safeFetch: response size cap (declared and streamed) and timeouts', async () => {
  const big = 'x'.repeat(10_000);
  const sf = createSafeFetch({ allowHosts: ['good.test'], maxBytes: 1000, fetchImpl: async () => res(big) });
  await rejects(sf('https://good.test/a'), 'too_large');
  const sf2 = createSafeFetch({ allowHosts: ['good.test'], maxBytes: 1000, fetchImpl: async () => res(big, { headers: { 'content-length': '10000' } }) });
  await rejects(sf2('https://good.test/a'), 'too_large');
  const sf3 = createSafeFetch({ allowHosts: ['good.test'], fetchImpl: async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; } });
  await rejects(sf3('https://good.test/a'), 'timeout');
  const sf4 = createSafeFetch({ allowHosts: ['good.test'], fetchImpl: async () => res('not json') });
  await rejects(sf4('https://good.test/a').then((r) => r.json()), 'parse');
});

// ───────────── cache ─────────────
test('cache: fresh hit, in-flight de-duplication, stale-on-error, persistence', async () => {
  let t = 1000; const now = () => t;
  const dir = mkdtempSync(join(tmpdir(), 'tc-cache-'));
  const cache = createCache({ dir, now });
  let calls = 0;
  const loader = async () => { calls += 1; return { n: calls }; };

  const [a, b] = await Promise.all([cache.wrap('k', { ttlMs: 100, persist: true }, loader), cache.wrap('k', { ttlMs: 100, persist: true }, loader)]);
  assert.equal(calls, 1, 'concurrent callers share one upstream call');
  assert.deepEqual(a.value, b.value);
  assert.equal((await cache.wrap('k', { ttlMs: 100 }, loader)).state, 'fresh');

  t += 500; // expired
  const failing = async () => { throw new Error('upstream down'); };
  const stale = await cache.wrap('k', { ttlMs: 100, staleMs: 10_000, persist: true }, failing);
  assert.equal(stale.state, 'stale');
  await assert.rejects(cache.wrap('k', { ttlMs: 100, staleMs: 0 }, failing), /upstream down/);
  await assert.rejects(cache.wrap('never', { ttlMs: 100, staleMs: 9999 }, failing), /upstream down/, 'no stale data → error propagates');

  // a fresh process (new cache object) reads persisted data from disk
  const cache2 = createCache({ dir, now });
  const fromDisk = await cache2.wrap('k', { ttlMs: 100_000, persist: true }, async () => { throw new Error('should not be called'); });
  assert.equal(fromDisk.state, 'fresh');
});

test('cache: corrupt disk entries are ignored; keys cannot escape the cache dir', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tc-cache-'));
  const cache = createCache({ dir });
  const r = await cache.wrap('../../etc/passwd', { ttlMs: 1000, persist: true }, async () => 'v');
  assert.equal(r.value, 'v');
  mkdirSync(join(dir, 'sub'), { recursive: true });
  writeFileSync(join(dir, 'garbage.json'), '{not json');
  assert.equal(createCache({ dir }).size(), 0);
});

// ───────────── rate limiting ─────────────
test('rate limiter: fixed window and reset', () => {
  let t = 0; const rl = createRateLimiter({ max: 3, windowMs: 1000, now: () => t });
  assert.deepEqual([1, 2, 3].map(() => rl.take('ip').allowed), [true, true, true]);
  assert.equal(rl.take('ip').allowed, false);
  assert.equal(rl.take('other').allowed, true, 'keys are independent');
  t = 1001;
  assert.equal(rl.take('ip').allowed, true);
});

test('daily budget: caps paid calls per UTC day; 0 = unlimited', () => {
  let t = Date.parse('2026-11-05T10:00:00Z');
  const b = createDailyBudget({ limit: 2, now: () => t });
  assert.deepEqual([b.take(), b.take(), b.take()], [true, true, false]);
  t = Date.parse('2026-11-06T00:00:01Z');
  assert.equal(b.take(), true, 'resets on a new UTC day');
  const unlimited = createDailyBudget({ limit: 0 });
  for (let i = 0; i < 1000; i++) assert.equal(unlimited.take(), true);
});

// ───────────── static path safety ─────────────
test('safeResolve blocks traversal, encoded traversal, NULs and dotfiles', () => {
  const root = mkdtempSync(join(tmpdir(), 'tc-static-'));
  assert.ok(safeResolve(root, '/index.html').startsWith(root));
  assert.ok(safeResolve(root, '/assets/app.js').startsWith(root));
  for (const bad of ['/../../etc/passwd', '/..%2f..%2fetc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/a/../../b', '/.env', '/.git/config', '/ok/.hidden', '/a%00b', '/%E0%A4%A']) {
    assert.equal(safeResolve(root, bad), null, `should block ${bad}`);
  }
});

// ───────────── host header / CSP / config ─────────────
test('hostAllowed: loopback bind only answers to localhost names (DNS-rebinding guard)', () => {
  const loop = { host: '127.0.0.1', allowedHosts: [] };
  const req = (host) => ({ headers: { host } });
  assert.equal(hostAllowed(req('localhost:8787'), loop), true);
  assert.equal(hostAllowed(req('127.0.0.1:8787'), loop), true);
  assert.equal(hostAllowed(req('[::1]:8787'), loop), true);
  assert.equal(hostAllowed(req('evil.example:8787'), loop), false);
  assert.equal(hostAllowed(req('evil.example'), { host: '0.0.0.0', allowedHosts: [] }), true, 'public bind: operator is expected to set ALLOWED_HOSTS');
  assert.equal(hostAllowed(req('evil.example'), { host: '0.0.0.0', allowedHosts: ['climate.example.org'] }), false);
  assert.equal(hostAllowed(req('climate.example.org:443'), { host: '0.0.0.0', allowedHosts: ['climate.example.org'] }), true);
});

test('CSP only allows optional third parties when they are configured', () => {
  const base = buildCsp({ cesiumIonToken: '', googleMapsKey: '' });
  assert.ok(!base.includes('cesium.com') && !base.includes('tile.googleapis.com'));
  assert.ok(base.includes("object-src 'none'") && base.includes("frame-ancestors 'none'") && !base.includes("'unsafe-eval'"));
  assert.ok(buildCsp({ cesiumIonToken: 'x', googleMapsKey: '' }).includes('cesium.com'));
  assert.ok(buildCsp({ cesiumIonToken: '', googleMapsKey: 'k' }).includes('tile.googleapis.com'));
});

test('config: defaults are keyless; invalid numbers fail loudly; provider auto-selection', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.host, '127.0.0.1');
  assert.equal(resolveNlpProvider(cfg).name, 'offline');
  assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT/);
  assert.throws(() => loadConfig({ NLP_DAILY_REQUEST_BUDGET: '-5' }), /NLP_DAILY_REQUEST_BUDGET/);
  assert.equal(resolveNlpProvider(loadConfig({ ANTHROPIC_API_KEY: 'k' })).name, 'anthropic');
  assert.equal(resolveNlpProvider(loadConfig({ OPENAI_API_KEY: 'k' })).name, 'offline', 'OpenAI needs an explicit model');
  assert.equal(resolveNlpProvider(loadConfig({ OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm' })).name, 'openai');
  assert.equal(resolveNlpProvider(loadConfig({ NLP_BASE_URL: 'http://localhost:11434/v1', NLP_MODEL: 'llama' })).name, 'compatible');
  const forced = resolveNlpProvider(loadConfig({ NLP_PROVIDER: 'anthropic' }));
  assert.equal(forced.name, 'offline');
  assert.match(forced.reason, /credentials/);
});
