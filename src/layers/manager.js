import { LAYERS, getLayer } from '../../shared/catalog.js';
import { apiGet } from '../api.js';
import { RasterLayer } from './rasterLayer.js';
import { AirQualityLayer, EmissionsLayer } from './pointLayers.js';

/**
 * Owns the live layer objects and keeps them in step with the store. The store
 * is the single source of truth: UI clicks, shared links and natural-language
 * commands all just change the store, and `reconcile` makes the map match.
 */
export class LayerManager {
  constructor({ viewer, mapStack, store }) {
    this.viewer = viewer;
    this.mapStack = mapStack;
    this.store = store;
    this.meta = {}; // id -> {start, end, legend} from /api/gibs/meta
    this.metaState = 'loading'; // loading | ok | unavailable
    this.listeners = new Set();
    this.layers = new Map();

    const deps = { viewer, mapStack, onStatus: (layer) => this.emit(layer.id) };
    for (const spec of LAYERS) {
      if (spec.kind === 'points') {
        this.layers.set(spec.id, spec.id === 'emissions' ? new EmissionsLayer(deps) : new AirQualityLayer(deps));
      } else {
        this.layers.set(spec.id, new RasterLayer(spec, {
          ...deps,
          getMeta: () => this.meta[spec.id],
          getDate: () => this.store.get().date,
          getOpacity: () => this.store.get().opacity[spec.id] ?? spec.opacity ?? 0.8,
        }));
      }
    }
    this.unsubscribe = store.subscribe((s, prev, changed) => this.reconcile(s, prev, changed));
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(id) { for (const fn of this.listeners) fn(id); }

  /** Status the UI shows for a layer. */
  status(id) { return this.layers.get(id)?.status ?? { state: 'unavailable', info: {} }; }
  legendUrl(id) { return this.meta[id]?.legend ?? null; }
  dateRange(id) { return this.meta[id] ? { start: this.meta[id].start, end: this.meta[id].end } : null; }
  isOn(id) { return this.store.get().layers.includes(id); }

  /** Fetch available dates + legends once; rebuild any dated layers already showing. */
  async loadMeta() {
    try {
      const body = await apiGet('/api/gibs/meta');
      this.meta = body.layers ?? {};
      this.metaState = 'ok';
    } catch {
      this.metaState = 'unavailable';
    }
    for (const layer of this.layers.values()) layer.refresh?.();
    this.emit('*');
  }

  /** Make live layers match the store. Called on every relevant store change. */
  reconcile(state, prev, changed) {
    if (changed.includes('layers')) {
      for (const [id, layer] of this.layers) {
        const want = state.layers.includes(id);
        const had = layer.enabled;
        if (want && !had) {
          if (id === 'emissions') layer.enable(state.emissions); else layer.enable();
        } else if (!want && had) layer.disable();
      }
    }
    if (changed.includes('date')) for (const layer of this.layers.values()) layer.refresh?.();
    if (changed.includes('opacity')) {
      for (const [id, layer] of this.layers) if (layer.setOpacity) layer.setOpacity(state.opacity[id] ?? getLayer(id)?.opacity ?? 0.8);
    }
    if (changed.includes('emissions')) this.layers.get('emissions').setFocus(state.emissions);
  }

  /** Apply the initial store state (layers restored from a link). */
  start() { this.reconcile(this.store.get(), this.store.get(), ['layers']); }

  destroy() { this.unsubscribe(); for (const l of this.layers.values()) l.destroy?.(); }
}
