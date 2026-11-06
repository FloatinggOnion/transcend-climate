# Data sources and licences

The code is MIT. **The data is not**: each source keeps its own terms. This table is also
what the in-app *About and data sources* dialog shows (`src/ui/sources.js`); keep both in
sync, and add a row here **before** adding a source.

Everything below is fetched live except the Natural Earth packs and the gazetteer, which
are bundled. Nothing here is a *keyed* dependency unless stated.

| Source | Used for | Licence / terms | Commercial use | Key |
|---|---|---|---|---|
| NASA GIBS (EOSDIS) | Satellite imagery layers and basemap (MODIS, GPM IMERG, AIRS, OMI, GHRSST MUR, Blue Marble) | NASA open data; acknowledge NASA/EOSDIS | ✅ | none |
| NASA POWER (MERRA-2) | Monthly temperature/rain vs 2001–2025 normal | NASA open data | ✅ | none |
| Hansen/UMD/Google/USGS/NASA | Tree-cover loss tiles (`gfc_v1.13`, public bucket) | CC BY 4.0 | ✅ with attribution | none |
| Climate TRACE | Facility emissions (modelled estimates) | CC BY 4.0 | ✅ with attribution | none |
| OpenAQ | Ground-station PM2.5 | Open data; individual providers' terms apply (see openaq.org) | ✅ check provider terms | **free key**, optional |
| Natural Earth | Gazetteer, country borders, named regions (bundled, pinned by SHA-256) | Public domain | ✅ | none |
| OpenStreetMap Nominatim | Place-search fallback only | ODbL 1.0 + [usage policy](https://operations.osmfoundation.org/policies/nominatim/) (≤1 req/s, identifying User-Agent — enforced by the server) | ✅ at low volume; set `GEOCODER_USER_AGENT` | none |
| Re:Earth Terrain / Mapterhorn | Terrain relief (keyless) | CC BY 4.0 | ✅ | none |
| Cesium ion / Bing / Google 3D Tiles / OSM tiles | **Optional** upgrades if you supply keys | Their own terms (Google: no caching/redistribution; OSM tile servers: not for heavy or commercial use) | per provider | yours |

## What was dropped from God's Eye View, and why

| Dropped | Reason |
|---|---|
| TeleGeography submarine cables | CC BY-**NC**-SA: non-commercial |
| OpenSky (flights) | Non-commercial research licence |
| Google News RSS | Terms restrict to personal, non-commercial use |
| Google Photorealistic 3D Tiles as the *default* | Needs a paid key and forbids caching/redistribution; kept only as an optional bring-your-own-key stack |
| OSM tile servers as the default basemap | OSMF policy discourages bulk/commercial use; NASA GIBS imagery is public domain |
| Datacenters / dams (ODbL OSM extracts), 3D aircraft models, demo GIFs | Not climate-relevant; models carry per-file licences |

## Honest caveats

- **Open-Meteo is deliberately not used.** Its free API is for non-commercial use; a product you may sell shouldn't depend on it. NASA POWER is the keyless, commercial-safe substitute.
- **Satellite layers lag real time by 1–6 days**, and the lag differs per layer (the UI shows each layer's actual date).
- **Climate TRACE figures are modelled estimates**, not measurements; the UI says so on every emissions card.
- **OpenAQ coverage in Africa is sparse.** That layer is written against OpenAQ's documented v3 API and unit-tested on fixtures shaped like it, but it has **not** been run against the live API (that needs a key).
