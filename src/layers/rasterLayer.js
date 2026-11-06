import * as Cesium from 'cesium';
import { addDays, clampDate, formatDate } from '../../shared/catalog.js';
import { governorRequestRender } from '../engine/renderGovernor.js';
import { createGibsProvider, createXyzProvider } from './gibsProvider.js';

const ERROR_WINDOW_MS = 30_000;
const ERROR_THRESHOLD = 12;

/**
 * An imagery layer from the catalog (NASA GIBS WMTS, or Hansen forest-loss XYZ).
 * Dated layers are rebuilt when the date changes; the effective date is the
 * requested date clamped to what the server says exists for that layer.
 */
export class RasterLayer {
  constructor(spec, { viewer, mapStack, getMeta, getDate, getOpacity, onStatus }) {
    this.spec = spec;
    this.id = spec.id;
    this.viewer = viewer;
    this.mapStack = mapStack;
    this.getMeta = getMeta; // () => {start, end, legend} | undefined
    this.getDate = getDate; // () => requested date | null
    this.getOpacity = getOpacity; // () => number
    this.onStatus = onStatus;
    this.imageryLayer = null;
    this.errors = [];
    this.enabled = false;
    this.status = { state: 'nominal', info: {} };
  }

  get dated() { return this.spec.kind === 'gibs' && this.spec.gibs.dated; }

  /** The date actually shown, and whether it differs from what was asked for. */
  effectiveDate() {
    if (!this.dated) return { date: null, clamped: false, known: true };
    const meta = this.getMeta();
    const requested = this.getDate();
    if (!meta?.end) {
      // Server metadata not available (yet): a conservative guess keeps the layer usable.
      return { date: addDays(formatDate(new Date()), -4), clamped: false, known: false };
    }
    const date = clampDate(requested ?? meta.end, meta.start, meta.end);
    return { date, clamped: requested !== null && date !== requested, known: true };
  }

  enable() { this.enabled = true; this.build(); }

  disable() {
    this.enabled = false;
    this.teardown();
    this.setStatus({ state: 'nominal', info: {} });
  }

  /** Rebuild when the requested date or server metadata changes. */
  refresh() { if (this.enabled && this.dated) this.build(); }

  setOpacity(a) {
    if (this.imageryLayer) { this.imageryLayer.alpha = a; governorRequestRender('opacity'); }
  }

  build() {
    this.teardown();
    const { date, clamped, known } = this.effectiveDate();
    let provider;
    try {
      provider = this.spec.kind === 'gibs'
        ? createGibsProvider({ ...this.spec.gibs, date })
        : createXyzProvider({ ...this.spec.xyz, credit: new Cesium.Credit(`Data: ${this.spec.source}`, true) });
    } catch (err) {
      console.warn(`[layer:${this.id}]`, err);
      this.setStatus({ state: 'unavailable', info: {} });
      return;
    }
    this.errors = [];
    provider.errorEvent.addEventListener((tileError) => {
      // Retry a tile once (flaky mobile networks), then give up quietly.
      tileError.retry = tileError.timesRetried < 1;
      if (tileError.retry) return;
      const now = Date.now();
      this.errors = this.errors.filter((t) => now - t < ERROR_WINDOW_MS).concat(now);
      if (this.errors.length > ERROR_THRESHOLD && this.status.state !== 'degraded') this.setStatus({ state: 'degraded', info: this.status.info });
    });
    this.imageryLayer = new Cesium.ImageryLayer(provider, { alpha: this.getOpacity() });
    this.viewer.imageryLayers.add(this.imageryLayer);
    this.mapStack.raiseReference();
    const info = { date, clamped };
    // Honest status: metadata we could not verify, or a date older than requested, is "stale", not "live".
    this.setStatus({ state: !known ? 'stale' : clamped ? 'stale' : 'nominal', info });
    governorRequestRender('layer-build');
  }

  teardown() {
    if (this.imageryLayer) {
      this.viewer.imageryLayers.remove(this.imageryLayer, true);
      this.imageryLayer = null;
      governorRequestRender('layer-teardown');
    }
  }

  setStatus(status) { this.status = status; this.onStatus?.(this); }
  destroy() { this.teardown(); }
}
