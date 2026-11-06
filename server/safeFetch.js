// Outbound HTTP with a hard host allow-list.
//
// The server never fetches a URL a client supplied. Even so, every outbound
// call goes through here so that (a) a bug can't turn the server into an open
// proxy / SSRF primitive, (b) a slow or hostile upstream can't hang or OOM us,
// and (c) redirects can't smuggle a request to a host we didn't approve.

export class UpstreamError extends Error {
  /** @param {'blocked'|'timeout'|'too_large'|'http'|'network'|'parse'} code */
  constructor(code, message, status = null) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
    this.status = status;
  }
}

/** Hosts the server is allowed to call. Add deliberately; each is a trust decision. */
export const ALLOWED_HOSTS = Object.freeze([
  'gibs.earthdata.nasa.gov',
  'power.larc.nasa.gov',
  'api.climatetrace.org',
  'api.openaq.org',
  'nominatim.openstreetmap.org',
  'api.anthropic.com',
  'api.openai.com',
]);

const MAX_REDIRECTS = 3;

/**
 * @param {object} opts
 * @param {readonly string[]} [opts.allowHosts]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxBytes]
 * @param {string} [opts.userAgent]
 */
export function createSafeFetch({
  allowHosts = ALLOWED_HOSTS,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
  maxBytes = 8_000_000,
  userAgent = 'TranscendClimate/0.1',
} = {}) {
  const allow = new Set(allowHosts.map((h) => h.toLowerCase()));

  function check(urlLike) {
    let u;
    try { u = new URL(urlLike); } catch { throw new UpstreamError('blocked', 'invalid URL'); }
    if (u.protocol !== 'https:') throw new UpstreamError('blocked', `blocked non-https URL (${u.protocol})`);
    if (u.username || u.password) throw new UpstreamError('blocked', 'blocked URL with credentials');
    if (u.port && u.port !== '443') throw new UpstreamError('blocked', `blocked non-standard port ${u.port}`);
    if (!allow.has(u.hostname.toLowerCase())) throw new UpstreamError('blocked', `host not allow-listed: ${u.hostname}`);
    return u;
  }

  /**
   * @param {string} url
   * @param {{method?: string, headers?: Record<string,string>, body?: string, timeoutMs?: number, maxBytes?: number}} [init]
   * @returns {Promise<{status: number, ok: boolean, headers: Headers, buffer: Buffer, text: () => string, json: () => any}>}
   */
  return async function safeFetch(url, init = {}) {
    let current = check(url);
    const limit = init.maxBytes ?? maxBytes;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let res;
      try {
        res = await fetchImpl(current, {
          method: init.method || 'GET',
          headers: { 'user-agent': userAgent, accept: 'application/json, */*;q=0.5', ...init.headers },
          body: init.body,
          redirect: 'manual',
          signal: AbortSignal.timeout(init.timeoutMs ?? timeoutMs),
        });
      } catch (err) {
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new UpstreamError('timeout', `upstream timeout: ${current.hostname}`);
        throw new UpstreamError('network', `upstream network error: ${current.hostname}`);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel?.();
        current = check(new URL(res.headers.get('location'), current).href); // re-validate every hop
        continue;
      }
      // Stream with a hard byte cap.
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > limit) { await res.body?.cancel?.(); throw new UpstreamError('too_large', 'upstream response too large'); }
      const chunks = []; let total = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          let r;
          try { r = await reader.read(); } catch { throw new UpstreamError('network', 'upstream stream error'); }
          if (r.done) break;
          total += r.value.byteLength;
          if (total > limit) { await reader.cancel(); throw new UpstreamError('too_large', 'upstream response too large'); }
          chunks.push(r.value);
        }
      }
      const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
      return {
        status: res.status,
        ok: res.ok,
        headers: res.headers,
        buffer,
        text: () => buffer.toString('utf8'),
        json: () => {
          try { return JSON.parse(buffer.toString('utf8')); } catch { throw new UpstreamError('parse', 'upstream returned invalid JSON'); }
        },
      };
    }
    throw new UpstreamError('blocked', 'too many redirects');
  };
}
