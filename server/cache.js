// TTL cache with in-flight de-duplication, stale-on-error, and optional disk
// persistence. Upstream APIs (NASA, Climate TRACE, OpenAQ) are rate-limited and
// slow; this keeps one self-hosted instance polite and resilient. A user
// request is never forwarded 1:1 to an upstream.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export function createCache({ dir = null, now = () => Date.now(), maxEntries = 500 } = {}) {
  /** @type {Map<string, {value: any, fetchedAt: number}>} */
  const mem = new Map();
  /** @type {Map<string, Promise<any>>} */
  const inflight = new Map();
  if (dir) { try { mkdirSync(dir, { recursive: true }); } catch { dir = null; } }

  const fileFor = (key) => join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 40)}.json`);

  function readDisk(key) {
    if (!dir) return null;
    try {
      const parsed = JSON.parse(readFileSync(fileFor(key), 'utf8'));
      if (parsed && parsed.key === key && typeof parsed.fetchedAt === 'number') return { value: parsed.value, fetchedAt: parsed.fetchedAt };
    } catch { /* missing or corrupt: treat as a miss */ }
    return null;
  }

  function writeDisk(key, entry) {
    if (!dir) return;
    try {
      const f = fileFor(key);
      writeFileSync(`${f}.tmp`, JSON.stringify({ key, ...entry }));
      renameSync(`${f}.tmp`, f); // atomic: readers never see a half-written file
    } catch { /* disk cache is best-effort */ }
  }

  function remember(key, entry) {
    mem.delete(key);
    mem.set(key, entry);
    while (mem.size > maxEntries) mem.delete(mem.keys().next().value);
  }

  /**
   * @template T
   * @param {string} key
   * @param {{ttlMs: number, staleMs?: number, persist?: boolean}} opts
   * @param {() => Promise<T>} loader
   * @returns {Promise<{value: T, state: 'fresh'|'miss'|'stale', fetchedAt: number}>}
   */
  async function wrap(key, { ttlMs, staleMs = 0, persist = false }, loader) {
    let entry = mem.get(key) || (persist ? readDisk(key) : null);
    if (entry && !mem.has(key)) remember(key, entry);
    const age = entry ? now() - entry.fetchedAt : Infinity;
    if (entry && age < ttlMs) return { value: entry.value, state: 'fresh', fetchedAt: entry.fetchedAt };

    if (!inflight.has(key)) {
      const p = (async () => {
        const value = await loader();
        const fresh = { value, fetchedAt: now() };
        remember(key, fresh);
        if (persist) writeDisk(key, fresh);
        return fresh;
      })().finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    try {
      const fresh = await inflight.get(key);
      return { value: fresh.value, state: 'miss', fetchedAt: fresh.fetchedAt };
    } catch (err) {
      // Serve stale data rather than an error, if we have any within the stale window.
      if (entry && age < ttlMs + staleMs) return { value: entry.value, state: 'stale', fetchedAt: entry.fetchedAt };
      throw err;
    }
  }

  return { wrap, size: () => mem.size, _mem: mem };
}
