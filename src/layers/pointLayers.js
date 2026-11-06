import * as Cesium from 'cesium';
import { apiGet, ApiError } from '../api.js';
import { governorRequestRender } from '../engine/renderGovernor.js';
import { viewRectangle } from '../engine/viewer.js';
import { SECTOR_COLORS } from '../../shared/catalog.js';

const sectorColor = (s) => Cesium.Color.fromCssColorString(SECTOR_COLORS[s] ?? '#cfcfcf');
const NIGERIA_BBOX = [2.6, 4.2, 14.7, 13.9];

class PointLayerBase {
  constructor({ viewer, onStatus }) {
    this.viewer = viewer;
    this.onStatus = onStatus;
    this.points = null;
    this.labels = null;
    this.enabled = false;
    this.seq = 0; // guards against out-of-order responses
    this.status = { state: 'nominal', info: {} };
  }

  ensureCollections() {
    if (this.points) return;
    this.points = this.viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.labels = this.viewer.scene.primitives.add(new Cesium.LabelCollection());
  }

  clearPrimitives() { this.points?.removeAll(); this.labels?.removeAll(); governorRequestRender('points-clear'); }

  setStatus(status) { this.status = status; this.onStatus?.(this); }

  disable() {
    this.enabled = false;
    this.seq += 1; // cancel any in-flight load
    this.clearPrimitives();
    this.setStatus({ state: 'nominal', info: {} });
  }

  destroy() {
    for (const c of [this.points, this.labels]) if (c) this.viewer.scene.primitives.remove(c);
    this.points = this.labels = null;
  }

  failureState(err) {
    if (err instanceof ApiError && err.code === 'not_configured') return 'needs_key';
    return this.status.info?.count > 0 ? 'stale' : 'unavailable';
  }
}

/** Facility emissions (Climate TRACE). Focus = { country: ISO3, sector }. */
export class EmissionsLayer extends PointLayerBase {
  constructor(deps) { super(deps); this.id = 'emissions'; this.focus = { country: 'NGA', sector: 'all' }; this.data = null; }

  enable(focus) { this.enabled = true; if (focus) this.focus = focus; return this.load(); }

  setFocus(focus) {
    this.focus = focus;
    return this.enabled ? this.load() : Promise.resolve();
  }

  async load() {
    const seq = ++this.seq;
    this.setStatus({ state: 'loading', info: { ...this.status.info } });
    try {
      const { country, sector } = this.focus;
      const data = await apiGet(`/api/emissions?country=${country}&sector=${encodeURIComponent(sector)}&limit=150`);
      if (seq !== this.seq || !this.enabled) return;
      this.data = data;
      this.ensureCollections();
      this.clearPrimitives();
      data.facilities.forEach((f, i) => {
        const position = Cesium.Cartesian3.fromDegrees(f.lon, f.lat, 50);
        this.points.add({
          position, id: { kind: 'facility', facility: f, year: data.year },
          pixelSize: 6 + 4 * Math.log10(1 + f.co2e / 1e5),
          color: sectorColor(f.sector).withAlpha(0.9), outlineColor: Cesium.Color.BLACK.withAlpha(0.7), outlineWidth: 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        if (i < 6) {
          this.labels.add({
            position, text: f.name, font: '600 12px system-ui, sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(10, -10), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2_500_000), disableDepthTestDistance: Number.POSITIVE_INFINITY,
          });
        }
      });
      governorRequestRender('emissions-loaded');
      this.setStatus({ state: data.state === 'stale' ? 'stale' : 'nominal', info: { count: data.count, year: data.year, total: data.totalCo2e, country: data.country, sector: data.sector } });
    } catch (err) {
      if (seq !== this.seq) return;
      this.setStatus({ state: this.failureState(err), info: { ...this.status.info } });
    }
  }
}

/** Ground-station PM2.5 (OpenAQ). Needs a server-side key; reports `needs_key` otherwise. */
export class AirQualityLayer extends PointLayerBase {
  constructor(deps) { super(deps); this.id = 'airquality'; this.lastKey = null; this.moveTimer = null; }

  enable() {
    this.enabled = true;
    this.removeMove = this.viewer.camera.moveEnd.addEventListener(() => {
      clearTimeout(this.moveTimer);
      this.moveTimer = setTimeout(() => this.load(), 800);
    });
    return this.load(true);
  }

  disable() { this.removeMove?.(); clearTimeout(this.moveTimer); this.lastKey = null; super.disable(); }

  bbox() {
    const r = viewRectangle(this.viewer);
    if (!r || r.east - r.west > 40 || r.north - r.south > 40) return NIGERIA_BBOX; // too wide to query: default to the focus region
    return [r.west, r.south, r.east, r.north].map((v) => Math.round(v * 10) / 10);
  }

  async load(force = false) {
    const bbox = this.bbox();
    const key = bbox.map((v, i) => (i < 2 ? Math.floor(v) : Math.ceil(v))).join(',');
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    const seq = ++this.seq;
    this.setStatus({ state: 'loading', info: { ...this.status.info } });
    try {
      const data = await apiGet(`/api/airquality?bbox=${bbox.join(',')}`);
      if (seq !== this.seq || !this.enabled) return;
      this.ensureCollections();
      this.clearPrimitives();
      for (const s of data.stations) {
        const position = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 50);
        this.points.add({
          position, id: { kind: 'station', station: s },
          pixelSize: 13, color: Cesium.Color.fromCssColorString(s.color), outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        this.labels.add({
          position, text: String(Math.round(s.pm25)), font: '700 12px system-ui, sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -18),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3_000_000), disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
      governorRequestRender('airquality-loaded');
      this.setStatus({ state: data.state === 'stale' ? 'stale' : 'nominal', info: { count: data.count } });
    } catch (err) {
      if (seq !== this.seq) return;
      this.lastKey = null; // let the next move retry
      this.setStatus({ state: this.failureState(err), info: { ...this.status.info } });
    }
  }
}
