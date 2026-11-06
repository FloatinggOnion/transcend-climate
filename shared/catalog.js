// Single source of truth for the data-layer catalog. Imported by the server
// (validation, GIBS metadata extraction, NLP tool schemas) and by the browser
// (layer panel, providers), so a layer id means the same thing everywhere.
//
// Pure data + tiny helpers: no DOM, no Cesium, no Node APIs.

/** @typedef {{layer:string, tms:string, ext:'png'|'jpeg', maxLevel:number, dated:boolean}} GibsSpec */

/**
 * kind:
 *   'gibs'   NASA GIBS WMTS raster (public domain; keyless; optionally dated)
 *   'xyz'    plain Web-Mercator XYZ raster (Hansen forest loss)
 *   'points' server-proxied point data (Climate TRACE, OpenAQ)
 *
 * `keywords` feed the offline NLP parser; each language maps to words a user
 * might say for this layer. The LLM path does not need them.
 */
export const LAYERS = Object.freeze([
  {
    id: 'lst', group: 'atmosphere', kind: 'gibs', icon: '🌡️', opacity: 0.8,
    gibs: { layer: 'MODIS_Terra_Land_Surface_Temp_Day', tms: 'GoogleMapsCompatible_Level7', ext: 'png', maxLevel: 7, dated: true },
    unit: '°C', source: 'NASA MODIS / GIBS',
  },
  {
    id: 'precip', group: 'atmosphere', kind: 'gibs', icon: '🌧️', opacity: 0.8,
    gibs: { layer: 'IMERG_Precipitation_Rate', tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxLevel: 6, dated: true },
    unit: 'mm/h', source: 'NASA GPM IMERG / GIBS',
  },
  {
    id: 'clouds', group: 'atmosphere', kind: 'gibs', icon: '☁️', opacity: 0.7,
    gibs: { layer: 'MODIS_Terra_Cloud_Fraction_Day', tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxLevel: 6, dated: true },
    unit: '%', source: 'NASA MODIS / GIBS',
  },
  {
    id: 'sst', group: 'ocean', kind: 'gibs', icon: '🌊', opacity: 0.85,
    gibs: { layer: 'GHRSST_L4_MUR_Sea_Surface_Temperature', tms: 'GoogleMapsCompatible_Level7', ext: 'png', maxLevel: 7, dated: true },
    unit: '°C', source: 'NASA JPL MUR SST / GIBS',
  },
  {
    id: 'ndvi', group: 'land', kind: 'gibs', icon: '🌿', opacity: 0.85,
    gibs: { layer: 'MODIS_Terra_NDVI_8Day', tms: 'GoogleMapsCompatible_Level9', ext: 'png', maxLevel: 9, dated: true },
    unit: 'NDVI', source: 'NASA MODIS / GIBS',
  },
  {
    // Hansen/UMD tree-cover loss 2001–present, pre-rendered with alpha (red =
    // loss). Hosted in the dataset authors' public bucket. CC BY 4.0.
    id: 'forestloss', group: 'land', kind: 'xyz', icon: '🌳', opacity: 0.9,
    xyz: {
      url: 'https://storage.googleapis.com/earthenginepartners-hansen/tiles/gfc_v1.13/loss_alpha/{z}/{x}/{y}.png',
      maxLevel: 12, tileSize: 256,
    },
    unit: null, source: 'Hansen/UMD/Google/USGS/NASA (CC BY 4.0)',
  },
  {
    id: 'aod', group: 'air', kind: 'gibs', icon: '🌫️', opacity: 0.8,
    gibs: { layer: 'MODIS_Combined_Value_Added_AOD', tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxLevel: 6, dated: true },
    unit: 'AOD', source: 'NASA MODIS MAIAC / GIBS',
  },
  {
    id: 'no2', group: 'air', kind: 'gibs', icon: '🏭', opacity: 0.85,
    gibs: { layer: 'OMI_Nitrogen_Dioxide_Tropo_Column', tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxLevel: 6, dated: true },
    unit: 'molecules/cm²', source: 'NASA Aura OMI / GIBS',
  },
  {
    id: 'co', group: 'air', kind: 'gibs', icon: '💨', opacity: 0.8,
    gibs: { layer: 'AIRS_L2_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Day', tms: 'GoogleMapsCompatible_Level6', ext: 'png', maxLevel: 6, dated: true },
    unit: 'ppbv', source: 'NASA AIRS / GIBS',
  },
  {
    // Ground-station PM2.5. Needs OPENAQ_API_KEY on the server.
    id: 'airquality', group: 'air', kind: 'points', icon: '📍', needs: 'openaq',
    unit: 'µg/m³', source: 'OpenAQ',
  },
  {
    // Facility-level emissions. Keyless; CC BY 4.0.
    id: 'emissions', group: 'emissions', kind: 'points', icon: '🏭', needs: null,
    unit: 't CO₂e', source: 'Climate TRACE (CC BY 4.0)',
  },
]);

/**
 * PM2.5 bands, US EPA 24-hour AQI breakpoints (2024 revision), µg/m³. Shared by
 * the server (classifying readings) and the browser (legend), so they cannot drift.
 */
export const PM25_BANDS = Object.freeze([
  { max: 9.0, id: 'good', color: '#2e9e5b' },
  { max: 35.4, id: 'moderate', color: '#e0c030' },
  { max: 55.4, id: 'unhealthy_sensitive', color: '#f08a24' },
  { max: 125.4, id: 'unhealthy', color: '#d9362b' },
  { max: 225.4, id: 'very_unhealthy', color: '#8f3f97' },
  { max: Infinity, id: 'hazardous', color: '#7e0023' },
]);

/** Marker colours per emissions sector (colour-blind-distinguishable set). */
export const SECTOR_COLORS = Object.freeze({
  power: '#f2c230', 'fossil-fuel-operations': '#e8643f', manufacturing: '#9b7fe0', 'mineral-extraction': '#3fb5ad',
  waste: '#a0a0a0', agriculture: '#7bc65a', transportation: '#5aa2e6', buildings: '#d98fc4',
});

/** Daily satellite photo basemap: dated like a data layer, so the server verifies its date range too. */
export const TRUE_COLOR_GIBS = Object.freeze({ layer: 'MODIS_Terra_CorrectedReflectance_TrueColor', tms: 'GoogleMapsCompatible_Level9', ext: 'jpeg', maxLevel: 9, dated: true });

export const LAYER_IDS = Object.freeze(LAYERS.map((l) => l.id));
export const GROUPS = Object.freeze(['atmosphere', 'ocean', 'land', 'air', 'emissions']);

export function getLayer(id) { return LAYERS.find((l) => l.id === id) || null; }

/**
 * Climate TRACE sectors (exactly as returned by GET /v6/definitions/sectors).
 * Doubles as the allow-list for query params and NLP tool input.
 */
export const EMISSION_SECTORS = Object.freeze([
  'power', 'fossil-fuel-operations', 'manufacturing', 'mineral-extraction', 'waste',
  'agriculture', 'transportation', 'buildings', 'forestry-and-land-use', 'fluorinated-gases',
]);

export const BASEMAP_IDS = Object.freeze(['blue-marble', 'true-color', 'bing-aerial', 'osm', 'photoreal']);

const GIBS_LAYER_RE = /^[A-Za-z0-9_]+$/;
const GIBS_TMS_RE = /^GoogleMapsCompatible_Level\d{1,2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build the GIBS WMTS URL template for Cesium's UrlTemplateImageryProvider.
 * Inputs are validated: the catalog is trusted, but the date may originate
 * from natural-language input, and nothing here may be turned into a request
 * to any host other than GIBS.
 */
export function gibsUrlTemplate({ layer, tms, ext, dated }, date = null) {
  if (!GIBS_LAYER_RE.test(layer)) throw new Error(`invalid GIBS layer: ${layer}`);
  if (!GIBS_TMS_RE.test(tms)) throw new Error(`invalid GIBS tile matrix set: ${tms}`);
  if (ext !== 'png' && ext !== 'jpeg') throw new Error(`invalid GIBS extension: ${ext}`);
  // EPSG:3857 (Web Mercator): a standard power-of-two XYZ pyramid. GIBS's EPSG:4326 grid is NOT
  // (level 0 = two 288° tiles, level 1 = 3×2 tiles of 144°…), which Cesium's tiling schemes cannot express.
  const base = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default`;
  if (!dated) return `${base}/${tms}/{z}/{y}/{x}.${ext}`;
  if (!isValidDate(date)) throw new Error(`invalid date for dated GIBS layer: ${date}`);
  return `${base}/${date}/${tms}/{z}/{y}/{x}.${ext}`;
}

/** True for a real calendar date in YYYY-MM-DD form. */
export function isValidDate(s) {
  if (!DATE_RE.test(String(s))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function formatDate(d) { return d.toISOString().slice(0, 10); }

/** Shift an ISO date by whole days (UTC). */
export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

/** Clamp a date into [min, max] (either may be null). */
export function clampDate(date, min, max) {
  let out = date;
  if (min && out < min) out = min;
  if (max && out > max) out = max;
  return out;
}
