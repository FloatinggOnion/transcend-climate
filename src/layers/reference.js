import * as Cesium from 'cesium';
import borders from '../../shared/borders.json';
import { governorRequestRender } from '../engine/renderGovernor.js';

// Native "Borders and place names" overlay, drawn from bundled public-domain Natural
// Earth data. It replaced NASA GIBS's reference tiles, which blanked the globe in
// Chromium and were English-only. Labels follow the interface language for countries.

const BORDER_HEIGHT_M = 2500; // lifted slightly so lines are not buried by terrain relief
const LABEL_FONT = '600 12px system-ui, sans-serif';

export class ReferenceOverlay {
  /** @param {Cesium.CesiumWidget} viewer @param {{gazetteer: object, getLang: () => string}} deps */
  constructor(viewer, { gazetteer, getLang }) {
    this.viewer = viewer;
    this.gazetteer = gazetteer;
    this.getLang = getLang;
    this.visible = true;

    this.lines = viewer.scene.primitives.add(new Cesium.PolylineCollection());
    const material = Cesium.Material.fromType('Color', { color: Cesium.Color.WHITE.withAlpha(0.5) });
    for (const flat of borders.lines) {
      this.lines.add({ positions: Cesium.Cartesian3.fromDegreesArrayHeights(withHeight(flat)), width: 1.1, material });
    }
    this.labels = viewer.scene.primitives.add(new Cesium.LabelCollection());
    this.relabel();
  }

  /** Rebuild labels (e.g. after a language change). Countries are localized; places keep gazetteer names. */
  relabel() {
    const lang = this.getLang();
    this.labels.removeAll();
    const add = (text, lon, lat, maxDist, scale = 1, color = Cesium.Color.WHITE) => this.labels.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, BORDER_HEIGHT_M), text, font: LABEL_FONT, scale,
      fillColor: color, outlineColor: Cesium.Color.BLACK.withAlpha(0.9), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER, verticalOrigin: Cesium.VerticalOrigin.CENTER,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, maxDist),
      disableDepthTestDistance: 3_000_000,
    });

    for (const c of this.gazetteer.countries()) {
      const africa = c.continent === 'Africa';
      add(c.names?.[lang] || c.name, c.lon, c.lat, africa ? 9_000_000 : 5_000_000, africa ? 1.05 : 0.9, Cesium.Color.fromCssColorString('#ffe9b0'));
    }
    for (const e of this.gazetteer.entities()) {
      if (e.type !== 'place') continue;
      const big = e.pop >= 1_000_000;
      const mid = e.pop >= 300_000 || e.cap === 2 || (e.country === 'NGA' && e.cap === 1);
      if (big) add(e.name, e.lon, e.lat, 2_800_000, 0.95);
      else if (mid) add(e.name, e.lon, e.lat, 1_300_000, 0.9);
      else if (e.country === 'NGA') add(e.name, e.lon, e.lat, 450_000, 0.85);
    }
    this.labels.show = this.visible;
    governorRequestRender('labels');
  }

  setVisible(v) {
    this.visible = !!v;
    this.lines.show = this.visible;
    this.labels.show = this.visible;
    governorRequestRender('reference');
  }
}

/** [lon,lat,lon,lat,…] → [lon,lat,h,lon,lat,h,…] */
function withHeight(flat) {
  const out = new Array((flat.length / 2) * 3);
  for (let i = 0, j = 0; i < flat.length; i += 2, j += 3) { out[j] = flat[i]; out[j + 1] = flat[i + 1]; out[j + 2] = BORDER_HEIGHT_M; }
  return out;
}
