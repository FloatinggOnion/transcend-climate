# Transcend Climate

Open climate-monitoring globe for **Nigeria and Africa**, for NGOs, foundations and companies.
Live NASA satellite layers, monthly climate vs normal, facility emissions, forest loss and
air quality — controlled by clicking **or by typing/speaking in plain language**, in 8 languages.

> Started from an audited slice of [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view)
> (MIT). See `NOTICE.md` and `docs/SUPPLY-CHAIN.md`.

## Run it

```sh
corepack enable            # or: npm i -g pnpm@11.5.2
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev                   # API on :8787, app on http://127.0.0.1:5173
```

No keys are needed. Production: `pnpm build && pnpm start` (serves `dist/` + API on one port),
or `docker build -t transcend-climate . && docker run -p 8787:8787 transcend-climate`.
All options are in `.env.example`.

## What you get

| Layer | Source | Key |
|---|---|---|
| Land temperature, rainfall, clouds, sea temperature, vegetation, dust/haze, NO₂, CO | NASA GIBS (daily; per-layer date range from the server) | none |
| Tree-cover loss since 2001 | Hansen/UMD (CC BY 4.0) | none |
| Facility emissions by country/sector | Climate TRACE (CC BY 4.0) | none |
| Click anywhere → temperature & rainfall vs 2001–2025 normal | NASA POWER | none |
| Ground PM2.5 stations | OpenAQ | free key |

Shareable links: the URL always encodes camera, layers, date, basemap and language, so you can send
a view in a DM. There is a **Data saver** mode (flat terrain, lighter rendering) for slow connections.

## Natural language (NLP)

`Try: "show rainfall over Kano"`, `"emissions in Ghana"`, `"how hot is Lagos compared to normal?"`,
`"outline the Sahel"`, `"montre la pluie au Sénégal"`, `"parle français"`.

1. **Free rule parser first** (en, fr, pt, sw, ar; starter vocab for ha, yo, ig; mixed-language works).
   Handles common commands instantly with no network and no cost.
2. **LLM for everything else**, if you configure a provider: Anthropic (default `claude-opus-5-5`),
   OpenAI, or any OpenAI-compatible endpoint (Ollama, vLLM…). Swappable in `.env`.
3. Whatever proposes an action, it's resolved and **validated on the server and again in the browser**
   (`shared/actions.js`). Numbers shown to users come from server tools, never from the model.

Voice input uses the browser's speech recognition (the vendor processes the audio; the UI says so).

## Languages

English, Français, Hausa, Yorùbá, Igbo, Kiswahili, العربية (RTL), Português — 176 UI strings each.
**Only English is reviewed.** The others are machine-drafted, labelled "draft" in the UI, and need
native-speaker review (Hausa, Yorùbá, Igbo most of all). `pnpm check:i18n` enforces key and
placeholder parity.

## Commands

```sh
pnpm test              # 137 tests: server, NLP, i18n, state codec, parsers
pnpm check:i18n        # locale parity
pnpm check:provenance  # ported files still match the audited originals
pnpm audit:deps        # CVEs + malware + publisher/age/provenance checks
node scripts/build-gazetteer.mjs   # rebuild places + borders from pinned Natural Earth (SHA-256 verified)
```

## Layout

```
server/   standalone Node API (no framework): safeFetch allow-list, cache, rate limits, routes, nlp/
shared/   catalog, action schema, gazetteer, lexicon — used by BOTH server and browser
src/      globe (engine/), layers/, ui/, nlp/, i18n/
provenance/PORT-MANIFEST.json   what was ported from upstream, verbatim vs modified
```

## Status — what is and isn't verified

Verified: all tests; the server against the **live** NASA GIBS/POWER, Climate TRACE and Nominatim
APIs; the built app rendering in a real browser (Chromium, Apple GPU) under the strict CSP.

**Not** verified (no key, device or reviewer available): the OpenAQ layer against the live API; the
Anthropic/OpenAI adapters against live endpoints (request shapes are unit-tested against the
documented API and a fake SDK); microphone input; phone layout and Arabic RTL layout visually; the
Docker image on your registry; native-speaker quality of non-English text.

Known limits: rate limiting is per process; `Reference` imagery from NASA is not used (it blanked the
globe in Chromium); Cesium's optional splat decoder is blocked by the CSP (unused).
