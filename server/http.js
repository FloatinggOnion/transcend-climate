import { createReadStream, statSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream';
import { extname, join, normalize, resolve, sep } from 'node:path';

export class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

// ───────────────────────── security headers ─────────────────────────

/** CSP is built from what is actually configured, so unused third parties stay blocked. */
export function buildCsp(cfg) {
  const img = ['https://gibs.earthdata.nasa.gov', 'https://storage.googleapis.com', 'https://tile.openstreetmap.org'];
  const connect = ['https://gibs.earthdata.nasa.gov', 'https://storage.googleapis.com', 'https://terrain.reearth.land', 'https://tile.openstreetmap.org'];
  if (cfg.cesiumIonToken) {
    img.push('https://*.cesium.com', 'https://*.virtualearth.net');
    connect.push('https://*.cesium.com', 'https://*.virtualearth.net');
  }
  if (cfg.googleMapsKey) {
    img.push('https://tile.googleapis.com');
    connect.push('https://tile.googleapis.com');
  }
  return [
    "default-src 'self'",
    // Cesium decodes meshes in WebAssembly; no eval, no inline scripts.
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    // Cesium's widgets set inline styles at runtime.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${img.join(' ')}`,
    `connect-src 'self' data: blob: ${connect.join(' ')}`,
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function securityHeaders(cfg) {
  return {
    'content-security-policy': buildCsp(cfg),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    // The microphone is used only for voice commands, only same-origin.
    'permissions-policy': 'microphone=(self), camera=(), geolocation=(self), payment=(), usb=()',
  };
}

// ───────────────────────── request helpers ─────────────────────────

export function clientIp(req, trustProxy, hops = 1) {
  if (trustProxy) {
    const raw = req.headers['x-forwarded-for'];
    if (typeof raw === 'string' && raw) {
      // Every trusted proxy appends the address it received the request from, so the
      // LEFT side is whatever the client chose to send. Count `hops` entries in from
      // the right. Too few entries means the request skipped the expected proxies:
      // fall through to the socket address rather than trust anything.
      const chain = raw.split(',').map((s) => s.trim()).filter(Boolean);
      const hit = chain[chain.length - hops];
      if (hit) return hit.slice(0, 64);
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const isLoopbackBind = (host) => ['127.0.0.1', 'localhost', '::1'].includes(host);

/**
 * DNS-rebinding defence: a malicious web page can point its own domain at
 * 127.0.0.1 and then talk to a local server. Rejecting unexpected Host headers
 * stops that. Enforced when bound to loopback or when ALLOWED_HOSTS is set.
 */
export function hostAllowed(req, cfg) {
  const hostHeader = String(req.headers.host || '').toLowerCase();
  const hostname = hostHeader.startsWith('[') ? hostHeader.slice(0, hostHeader.indexOf(']') + 1) : hostHeader.split(':')[0];
  if (cfg.allowedHosts?.length) return cfg.allowedHosts.map((h) => h.toLowerCase()).includes(hostname);
  if (isLoopbackBind(cfg.host)) return LOOPBACK_HOSTS.has(hostname);
  return true;
}

export async function readJsonBody(req, { maxBytes = 64 * 1024 } = {}) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  let total = 0; const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new HttpError(413, 'payload_too_large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'invalid_json'); }
}

export function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
}

// ───────────────────────── router ─────────────────────────

export function createRouter() {
  const routes = new Map(); // "METHOD path" -> {handler, limiter}
  return {
    add(method, path, handler, { limiter = null } = {}) { routes.set(`${method} ${path}`, { handler, limiter }); },
    match(method, path) { return routes.get(`${method} ${path}`) || null; },
    hasPath(path) { for (const k of routes.keys()) if (k.endsWith(` ${path}`)) return true; return false; },
  };
}

// ───────────────────────── static files ─────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.ktx2': 'image/ktx2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.xml', '.txt', '.wasm', '.gltf']);

/** Resolve a request path under root, refusing traversal, dotfiles and NULs. Returns an absolute path or null. */
export function safeResolve(root, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded.includes('\0')) return null;
  // Reject on the RAW segments, before normalize() can silently collapse a leading "..".
  if (decoded.split(/[\\/]/).some((seg) => seg.startsWith('.'))) return null;
  const rel = normalize(decoded).replace(/^([/\\])+/, '');
  const abs = resolve(join(root, rel));
  const base = resolve(root);
  if (abs !== base && !abs.startsWith(base + sep)) return null;
  return abs;
}

/** Serve a file (or the SPA index for extension-less paths). Returns true if handled. */
export function serveStatic(req, res, root, headers) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const { pathname } = new URL(req.url, 'http://local');
  let abs = safeResolve(root, pathname === '/' ? '/index.html' : pathname);
  if (!abs) return false;
  let st;
  try { st = statSync(abs); } catch { st = null; }
  if (st?.isDirectory()) { abs = join(abs, 'index.html'); try { st = statSync(abs); } catch { st = null; } }
  if (!st?.isFile()) {
    // SPA fallback only for extension-less, non-API paths.
    if (extname(pathname) || pathname.startsWith('/api/')) return false;
    abs = join(resolve(root), 'index.html');
    try { st = statSync(abs); } catch { return false; }
    if (!st.isFile()) return false;
  }
  const ext = extname(abs).toLowerCase();
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const isHtml = ext === '.html';
  const immutable = /[\\/]assets[\\/]/.test(abs);
  const cacheControl = isHtml ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=86400';
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag, 'cache-control': cacheControl, ...headers }); res.end(); return true; }
  const wantGzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  const outHeaders = {
    'content-type': MIME[ext] || 'application/octet-stream',
    etag, 'cache-control': cacheControl, vary: 'Accept-Encoding', ...headers,
    ...(wantGzip ? { 'content-encoding': 'gzip' } : { 'content-length': st.size }),
  };
  res.writeHead(200, outHeaders);
  if (req.method === 'HEAD') { res.end(); return true; }
  const stream = createReadStream(abs);
  if (wantGzip) pipeline(stream, createGzip(), res, () => {});
  else pipeline(stream, res, () => {});
  return true;
}
