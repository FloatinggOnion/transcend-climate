# Security

## Reporting
Email the maintainer listed in the repository (set a contact address here before
publishing: `SECURITY_CONTACT`). Please don't open public issues for vulnerabilities.

## Design in one paragraph
The browser talks only to this app's own server. The server talks only to a **fixed
allow-list of HTTPS hosts** (`server/safeFetch.js`), never to a URL a client supplied, never
follows a redirect to a host off the list, and caps every response's size and time. Natural-language
input can only ever produce a small set of **validated map actions**; nothing can fetch a URL, run
script, or change anything outside the map state.

## Controls (each is covered by a test)
| Threat | Control |
|---|---|
| SSRF / open proxy | Host allow-list, https only, no credentials/odd ports, redirects re-validated per hop |
| Malicious or hallucinated model output | Tools are an allow-list; every argument is type/range/enum-checked on the server **and again in the browser**; invalid calls are returned to the model as errors, never executed |
| Prompt injection (user text, tool results) | Model can only call the listed tools; replies are plain text rendered with `textContent`; numbers must come from server tools |
| XSS | No `innerHTML` anywhere; strict CSP: `script-src 'self' 'wasm-unsafe-eval'`, `object-src 'none'`, `frame-ancestors 'none'`, third-party hosts only when configured |
| DNS rebinding against a local server | `Host` header allow-list when bound to loopback (or `ALLOWED_HOSTS`) |
| Cost abuse of paid LLM | Free rule parser answers simple commands first; per-IP rate limit; **global daily call cap** (`NLP_DAILY_REQUEST_BUDGET`) |
| Path traversal | Static server rejects `..`, dotfiles, NULs, encoded variants |
| Secrets | Only the two *map* keys (`GOOGLE_MAPS_API_KEY`, `CESIUM_ION_TOKEN`) reach the browser, by design; **restrict them by HTTP referrer at the provider**. OpenAQ and LLM keys never leave the server |
| Hostile share links | `#…` state is validated field by field (catalog ids, ranges, ISO codes) |
| Supply chain | See `docs/SUPPLY-CHAIN.md` |

## Deployment checklist
1. Terminate TLS in front (Caddy/nginx/Cloudflare); set `TRUST_PROXY=true` only behind one.
2. Set `HOST=0.0.0.0` **and** `ALLOWED_HOSTS=your.domain` when exposing it.
3. Set `GEOCODER_USER_AGENT` to something that identifies you (OSM policy).
4. Set a provider-side spend limit on any LLM key, in addition to `NLP_DAILY_REQUEST_BUDGET`.
5. Restrict Google/Cesium keys by referrer. Never put server keys in `VITE_*` variables.
6. Run `pnpm audit:deps` on every dependency change.

## Known limits
- Rate limiting is per process and in memory (fine for one instance; use a proxy limiter for more).
- Browser voice input is processed by the *browser vendor's* speech service; the UI says so.
- Cesium's optional Gaussian-splat decoder uses `new Function` and is blocked by the CSP; the
  app never loads splats.
