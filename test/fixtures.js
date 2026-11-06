// Shared test fixtures. NASA POWER numbers are the real Lagos (6.5N, 3.5E) values.

export const CAPS = `<Capabilities><Contents>
<Layer><ows:Title>Land Surface Temperature (Day, MODIS, Terra)</ows:Title><ows:Identifier>MODIS_Terra_Land_Surface_Temp_Day</ows:Identifier>
<Style isDefault='true'><ows:Identifier>default</ows:Identifier>
<LegendURL xlink:role='http://earthdata.nasa.gov/gibs/legend-type/horizontal' xlink:title='H' format='image/svg+xml' xlink:href='https://gibs.earthdata.nasa.gov/legends/MODIS_Land_Surface_Temp_H.svg'/>
<LegendURL xlink:role='http://earthdata.nasa.gov/gibs/legend-type/vertical' format='image/svg+xml' xlink:href='https://gibs.earthdata.nasa.gov/legends/MODIS_Land_Surface_Temp_V.svg'/></Style>
<Dimension><ows:Identifier>Time</ows:Identifier><Default>2026-11-05</Default><Value>2000-02-24/2000-04-25/P1D</Value><Value>2000-04-28/2026-11-05/P1D</Value></Dimension></Layer>
<Layer><ows:Identifier>Some_Other_Layer</ows:Identifier><Dimension><Default>2020-01-01</Default><Value>2020-01-01/2020-01-01/P1D</Value></Dimension></Layer>
<Layer><ows:Identifier>EVIL_Legend</ows:Identifier><Style><LegendURL xlink:role='x/legend-type/horizontal' xlink:href='https://evil.test/x.svg'/></Style><Dimension><Default>2024-01-01</Default><Value>2024-01-01/2024-02-01/P1D</Value></Dimension></Layer>
</Contents></Capabilities>`;

const NORMAL_T = [26.19, 27.25, 27.65, 27.53, 27.14, 26.1, 25.14, 24.74, 25.32, 26.07, 26.84, 26.65];
const NORMAL_P = [0.81, 1.12, 2.3, 4.18, 6.1, 8.11, 6.61, 3.68, 8.15, 6.51, 2.36, 0.79];
const M = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const T26 = [27.44, 27.57, 27.98, 27.87, 27.62, 26.75, 25.93, 25.56, 26.04, -999, -999];
const P26 = [1.73, 0.98, 1.71, 3.9, 5.47, 21.87, 8.85, 2.08, 5.95, -999, -999];
const key = (y, m) => `${y}${String(m).padStart(2, '0')}`;

export const climatology = {
  properties: { parameter: {
    T2M: { ...Object.fromEntries(M.map((m, i) => [m, NORMAL_T[i]])), ANN: 26.38 },
    PRECTOTCORR: { ...Object.fromEntries(M.map((m, i) => [m, NORMAL_P[i]])), ANN: 4.23 },
  } },
  header: { range: '25-year Meteorological and Solar Monthly & Annual Climatologies (January 2001 - December 2025)' },
};

export const monthly = { properties: { parameter: {
  T2M: { ...Object.fromEntries(NORMAL_T.map((v, i) => [key(2025, i + 1), v + 0.3])), '202513': 26.6, ...Object.fromEntries(T26.map((v, i) => [key(2026, i + 1), v])) },
  PRECTOTCORR: { ...Object.fromEntries(NORMAL_P.map((v, i) => [key(2025, i + 1), v])), '202513': 4.2, ...Object.fromEntries(P26.map((v, i) => [key(2026, i + 1), v])) },
} } };

export const ctAsset = (id, name, co2e, lon, lat) => ({
  Id: id, Name: name, Country: 'NGA', Sector: 'electricity-generation', Centroid: { Geometry: [lon, lat] },
  EmissionsSummary: [{ Gas: 'co2e_100yr', EmissionsQuantity: co2e }], Owners: [{ CompanyName: 'Test Co' }],
});

export const openaqLocations = { results: [
  { id: 1, name: 'Lagos Station', coordinates: { latitude: 6.43, longitude: 3.42 }, datetimeLast: { utc: '2026-11-05T10:00:00Z' }, sensors: [{ id: 11, parameter: { id: 2, name: 'pm25' } }] },
] };
export const openaqLatest = { results: [{ sensorsId: 11, value: 42.4, datetime: { utc: '2026-11-05T10:00:00Z' } }] };

export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
