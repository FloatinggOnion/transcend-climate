// Data sources shown in the About dialog. This list is also the in-app
// attribution that several licences (CC BY 4.0, ODbL) require — keep it in sync
// with DATA_SOURCES.md, and add an entry before adding a new data source.
export const SOURCES = [
  { name: 'NASA GIBS / EOSDIS', what: 'Satellite imagery layers (MODIS, GPM IMERG, AIRS, OMI, GHRSST MUR)', license: 'NASA open data — free to use; acknowledge NASA/EOSDIS', url: 'https://earthdata.nasa.gov/gibs' },
  { name: 'NASA POWER (MERRA-2)', what: 'Monthly temperature and rainfall vs normal', license: 'NASA open data', url: 'https://power.larc.nasa.gov' },
  { name: 'Hansen / UMD / Google / USGS / NASA', what: 'Tree cover loss 2001–present', license: 'CC BY 4.0', url: 'https://glad.earthengine.app/view/global-forest-change' },
  { name: 'Climate TRACE', what: 'Facility-level greenhouse gas emissions (modelled estimates)', license: 'CC BY 4.0', url: 'https://climatetrace.org' },
  { name: 'OpenAQ', what: 'Ground-station air quality (PM2.5), where configured', license: 'Open data from OpenAQ and its providers', url: 'https://openaq.org' },
  { name: 'Natural Earth', what: 'Place names, countries and natural regions', license: 'Public domain', url: 'https://www.naturalearthdata.com' },
  { name: 'OpenStreetMap contributors', what: 'Place search fallback (Nominatim)', license: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright' },
  { name: 'Re:Earth Terrain / Mapterhorn', what: 'Terrain relief', license: 'CC BY 4.0', url: 'https://github.com/reearth/reearth-terrain' },
  { name: 'CesiumJS', what: '3D globe engine', license: 'Apache-2.0', url: 'https://cesium.com/platform/cesiumjs/' },
  { name: "God's Eye View", what: 'Original open-source project this app was adapted from (render governor, map stack, region lookup)', license: 'MIT © 2026 Bilawal Sidhu', url: 'https://github.com/bilawalsidhu/gods-eye-view' },
];
