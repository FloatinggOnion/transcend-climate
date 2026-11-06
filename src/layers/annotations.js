import * as Cesium from 'cesium';
import { governorRequestRender } from '../engine/renderGovernor.js';
import { lookupNaturalRegionOutline } from '../geo/naturalEarthRegions.js';

const ACCENT = Cesium.Color.fromCssColorString('#ffb347');

/** Markers, circles and region outlines drawn from natural-language commands. */
export class Annotations {
  constructor(viewer) {
    this.viewer = viewer;
    this.ds = new Cesium.CustomDataSource('annotations');
    viewer.dataSources.add(this.ds);
    this.count = 0;
  }

  label(text) {
    return {
      text, font: '600 14px system-ui, sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -16), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
  }

  /** @param {{kind: 'marker'|'circle'|'outline', lat: number, lon: number, radiusKm?: number|null, label?: string, place?: string}} a */
  async add(a) {
    const position = Cesium.Cartesian3.fromDegrees(a.lon, a.lat);
    const text = a.label || a.place || '';
    let kind = a.kind;
    let ring = null;
    if (kind === 'outline') {
      const hit = await lookupNaturalRegionOutline(a.place || text, a.lat, a.lon).catch(() => null);
      if (hit) ring = hit.ring; else kind = 'circle'; // not a known natural region: fall back to a circle
    }

    if (kind === 'outline' && ring) {
      const flat = ring.flatMap(([lon, lat]) => [lon, lat]).concat([ring[0][0], ring[0][1]]);
      this.ds.entities.add({
        polyline: { positions: Cesium.Cartesian3.fromDegreesArray(flat), width: 3, material: ACCENT, clampToGround: true },
        position, label: text ? this.label(text) : undefined,
      });
    } else if (kind === 'circle') {
      const r = Math.max(1, a.radiusKm ?? 25) * 1000;
      this.ds.entities.add({
        position,
        ellipse: { semiMajorAxis: r, semiMinorAxis: r, material: ACCENT.withAlpha(0.18), outline: true, outlineColor: ACCENT, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
        label: text ? this.label(text) : undefined,
      });
    } else {
      this.ds.entities.add({
        position,
        point: { pixelSize: 11, color: ACCENT, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: text ? this.label(text) : undefined,
      });
    }
    this.count += 1;
    governorRequestRender('annotation');
  }

  clear() { this.ds.entities.removeAll(); this.count = 0; governorRequestRender('annotation-clear'); }
}
