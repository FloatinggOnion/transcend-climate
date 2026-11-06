// Thin fetch wrapper for the app's own server. Distinguishes "can't reach the
// server" from "server said no", and never exposes raw server text to the UI.

export class ApiError extends Error {
  /** @param {'network'|'timeout'|'http'|'parse'} kind */
  constructor(kind, { status = null, code = null } = {}) {
    super(code ?? kind);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', body, signal, timeoutMs = 25_000 } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal && AbortSignal.any ? AbortSignal.any([signal, timeout]) : (signal ?? timeout);
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: combined,
      credentials: 'same-origin',
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new ApiError('timeout');
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('network');
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) throw new ApiError('http', { status: res.status, code: json?.error?.code ?? null });
  if (json === null) throw new ApiError('parse');
  return json;
}

export const apiGet = (path, opts) => request(path, opts);
export const apiPost = (path, body, opts) => request(path, { ...opts, method: 'POST', body });
