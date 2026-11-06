import * as Cesium from 'cesium';
import { gibsUrlTemplate } from '../../shared/catalog.js';

const CREDIT = new Cesium.Credit(
  'Imagery: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener noreferrer">NASA EOSDIS GIBS</a>',
  true,
);

/**
 * GIBS served in EPSG:3857 (GoogleMapsCompatible): a standard Web Mercator XYZ pyramid of
 * 256 px tiles, which Cesium's default tiling scheme handles natively.
 * @param {import('../../shared/catalog.js').GibsSpec & {date?: string|null}} spec
 */
export function createGibsProvider(spec) {
  return new Cesium.UrlTemplateImageryProvider({
    url: gibsUrlTemplate(spec, spec.date),
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    tileWidth: 256,
    tileHeight: 256,
    minimumLevel: 0,
    maximumLevel: spec.maxLevel,
    credit: CREDIT,
  });
}

/** Plain Web-Mercator XYZ raster (used for Hansen forest loss). */
export function createXyzProvider({ url, maxLevel, tileSize = 256, credit }) {
  if (!/^https:\/\//.test(url)) throw new Error('XYZ layers must use https');
  return new Cesium.UrlTemplateImageryProvider({
    url,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    tileWidth: tileSize,
    tileHeight: tileSize,
    minimumLevel: 0,
    maximumLevel: maxLevel,
    credit,
  });
}
