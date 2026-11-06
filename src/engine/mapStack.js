/**
 * Adapted from God's Eye View's mapStackController.js (MIT, (c) 2026 Bilawal
 * Sidhu), upstream commit 880a672b. See NOTICE.md.
 *
 * What was kept: the race-safe switch-generation guard (a slow provider that
 * resolves after a faster one must not revert the user's last choice), the
 * tri-state terrain tracking, and the never-throws keyless-terrain fallback.
 *
 * What changed: the default stack is keyless NASA GIBS imagery (public domain)
 * instead of Google Photorealistic 3D Tiles, which are now an optional
 * bring-your-own-key upgrade. A GIBS "reference" overlay (borders, coastlines,
 * place labels) is managed here too so it can stay above data layers.
 */
import * as Cesium from 'cesium';
import { governorRequestRender } from './renderGovernor.js';
import { createGibsProvider } from '../layers/gibsProvider.js';
import { TRUE_COLOR_GIBS, addDays, formatDate } from '../../shared/catalog.js';

export const MAP_STACKS = [
  {
    id: 'blue-marble',
    label: 'Blue Marble',
    kind: 'gibs',
    gibs: { layer: 'BlueMarble_ShadedRelief_Bathymetry', tms: 'GoogleMapsCompatible_Level8', ext: 'jpeg', maxLevel: 8, dated: false },
    requiresIon: false,
  },
  {
    id: 'true-color',
    label: 'Satellite (daily)',
    kind: 'gibs',
    gibs: TRUE_COLOR_GIBS,
    requiresIon: false,
  },
  { id: 'bing-aerial', label: 'Aerial (Bing)', kind: 'ion', requiresIon: true },
  { id: 'osm', label: 'OpenStreetMap', kind: 'osm', requiresIon: false },
  { id: 'photoreal', label: 'Google 3D', kind: 'photoreal', requiresIon: false },
];

const DEFAULT_OSM_CREDIT = '© OpenStreetMap contributors';

// Keyless global ellipsoidal terrain (Re:Earth Terrain / Mapterhorn, CC BY 4.0,
// EGM2008 geoid via NGA) — quantized-mesh 1.0, `ellipsoid` data-type. Built
// with `.fromUrl()`, never a hand-built `{z}/{x}/{y}.terrain` URL.
const REEARTH_TERRAIN_URL = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';

export class MapStack {
  /**
   * @param {Cesium.Viewer} viewer
   * @param {object} [options]
   * @param {Cesium.Cesium3DTileset|null} [options.googleTileset] optional BYO-key photoreal tileset
   * @param {string} [options.cesiumToken] optional Cesium ion token (enables Bing aerial + World Terrain)
   * @param {'reearth'|'flat'} [options.terrain] terrain source for globe stacks
   * @param {string} [options.initialStack]
   * @param {string} [options.date] YYYY-MM-DD for dated stacks
   * @param {(state: object) => void} [options.onChange]
   * @param {(message: string, stack?: object) => void} [options.onError]
   */
  constructor(viewer, {
    googleTileset = null,
    cesiumToken = '',
    terrain = 'reearth',
    initialStack = 'blue-marble',
    date = null,
    onChange = null,
    onError = null,
  } = {}) {
    this.viewer = viewer;
    this.googleTileset = googleTileset;
    this.cesiumToken = String(cesiumToken || '').trim();
    this.terrainSource = terrain;
    this._date = date;
    this._onChange = onChange;
    this._onError = onError;
    this._activeId = initialStack;
    this._imageryLayer = null;
    this._reference = null; // native borders+labels overlay (see layers/reference.js)
    this._referenceVisible = true;
    this._isSwitching = false;
    this._lastError = null;
    // Which terrain provider is actually installed: 'world' (ion), 'keyless'
    // (Re:Earth or its flat fallback), or null (never set). A tri-state, not a
    // boolean, so the first keyless switch isn't mistaken for a no-op.
    this._terrainMode = null;
    this._reearthTerrainProvider = null;
    // Monotonic switch counter: setStack() awaits network-bound provider
    // creation, so a slow A→B race must not revert the user's last choice.
    this._switchGen = 0;

    if (!this.getStack(this._activeId) || !this.isStackAvailable(this._activeId)) {
      this._activeId = 'blue-marble';
    }
  }

  getStacks() {
    return MAP_STACKS.map((stack) => {
      const available = this.isStackAvailable(stack.id);
      return { ...stack, available, unavailableReason: available ? null : this._unavailableReason(stack) };
    });
  }

  _unavailableReason(stack) {
    if (stack?.kind === 'photoreal') return 'Google 3D needs GOOGLE_MAPS_API_KEY on the server';
    if (stack?.requiresIon) return 'Cesium ion token required (CESIUM_ION_TOKEN)';
    return `${stack?.label || 'This map stack'} is unavailable`;
  }

  getStack(id) { return MAP_STACKS.find((stack) => stack.id === id) || null; }
  getActiveId() { return this._activeId; }
  getActiveStack() { return this.getStack(this._activeId); }
  getSwitchGeneration() { return this._switchGen; }

  isStackAvailable(id) {
    const stack = this.getStack(id);
    if (!stack) return false;
    if (stack.kind === 'photoreal') return !!this.googleTileset;
    if (stack.requiresIon) return !!this.cesiumToken;
    return true;
  }

  /** Change the date used by dated stacks (e.g. daily true-colour). */
  async setDate(date) {
    this._date = date;
    if (this.getActiveStack()?.gibs?.dated) await this.setStack(this._activeId, { silent: true, force: true });
  }

  async setStack(id, { silent = false, force = false } = {}) {
    const stack = this.getStack(id) || this.getStack('blue-marble');
    if (!force && stack.id === this._activeId && this._imageryLayer && !this._isSwitching) return this.getState();

    if (!this.isStackAvailable(stack.id)) {
      const message = this._unavailableReason(stack);
      this._lastError = message;
      this._onError?.(message, stack);
      return this.getState();
    }

    const gen = ++this._switchGen;
    this._isSwitching = true;
    this._lastError = null;
    if (!silent) this._emitChange('switching');

    try {
      if (stack.kind === 'photoreal') await this._activatePhotoreal(gen);
      else await this._activateGlobeStack(stack, gen);
      // A newer switch started while we awaited the provider — it owns the
      // final state now, so don't commit ours or emit a stale 'ready'.
      if (gen !== this._switchGen) return this.getState();
      this._activeId = stack.id;
      governorRequestRender('map-stack');
      if (!silent) this._emitChange('ready');
    } catch (error) {
      if (gen !== this._switchGen) return this.getState();
      const message = error?.message || String(error);
      this._lastError = message;
      this._onError?.(message, stack);
      // Fall back to the always-available keyless stack so the globe is never blank.
      if (stack.id !== 'blue-marble') {
        try { await this._activateGlobeStack(this.getStack('blue-marble'), gen); this._activeId = 'blue-marble'; } catch { /* leave as-is */ }
      }
      if (!silent) this._emitChange('error');
    } finally {
      if (gen === this._switchGen) this._isSwitching = false;
    }
    return this.getState();
  }

  getState(status = this._isSwitching ? 'switching' : 'ready') {
    return {
      activeId: this._activeId,
      activeStack: this.getActiveStack(),
      stacks: this.getStacks(),
      status,
      lastError: this._lastError,
      hasCesiumIonToken: !!this.cesiumToken,
      referenceVisible: this._referenceVisible,
    };
  }

  /** Switch terrain source at runtime (data-saver toggles this). */
  async setTerrainSource(source) {
    this.terrainSource = source === 'flat' ? 'flat' : 'reearth';
    this._terrainMode = null; // force re-evaluation
    await this._setTerrain(this._switchGen);
    governorRequestRender('terrain');
  }

  /** Attach the native borders+labels overlay so the "Borders and place names" toggle controls it. */
  attachReference(overlay) { this._reference = overlay; overlay.setVisible(this._referenceVisible); }

  setReferenceVisible(visible) {
    this._referenceVisible = !!visible;
    this._reference?.setVisible(this._referenceVisible);
    governorRequestRender('reference-overlay');
  }

  /** Kept for callers that add imagery after the base; the native overlay always draws on top. */
  raiseReference() {}

  async _activatePhotoreal() {
    this._removeImageryLayer();
    if (this.googleTileset) this.googleTileset.show = true;
    this.viewer.scene.globe.show = false;
  }

  async _activateGlobeStack(stack, gen) {
    const provider = await this._getImageryProvider(stack);
    if (gen != null && gen !== this._switchGen) return;
    this._removeImageryLayer();
    this._imageryLayer = new Cesium.ImageryLayer(provider);
    this.viewer.imageryLayers.add(this._imageryLayer, 0);
    if (this.googleTileset) this.googleTileset.show = false;
    this.viewer.scene.globe.show = true;
    await this._setTerrain(gen);
  }

  async _getImageryProvider(stack) {
    if (stack.kind === 'gibs') {
      // Dated imagery needs a date even before server metadata arrives: yesterday is almost always published.
      const date = stack.gibs.dated ? (this._date ?? addDays(formatDate(new Date()), -1)) : null;
      return createGibsProvider({ ...stack.gibs, date });
    }
    if (stack.kind === 'ion') return Cesium.createWorldImageryAsync({ style: Cesium.IonWorldImageryStyle.AERIAL });
    if (stack.kind === 'osm') return new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/', credit: DEFAULT_OSM_CREDIT });
    throw new Error(`Unsupported map stack: ${stack.id}`);
  }

  _removeImageryLayer() {
    if (!this._imageryLayer) return;
    this.viewer.imageryLayers.remove(this._imageryLayer, false);
    this._imageryLayer = null;
  }

  /**
   * Install the terrain for the current globe stack. With an ion token we use
   * Cesium World Terrain; otherwise the keyless Re:Earth mesh (or flat, if the
   * endpoint can't be reached). `gen` discards a result superseded mid-fetch.
   */
  async _setTerrain(gen) {
    const targetMode = this.cesiumToken ? 'world' : (this.terrainSource === 'flat' ? 'flat' : 'keyless');
    if (targetMode === this._terrainMode) return;
    if (targetMode === 'world') {
      this.viewer.scene.setTerrain(Cesium.Terrain.fromWorldTerrain({ requestVertexNormals: true }));
    } else if (targetMode === 'flat') {
      this.viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    } else {
      const provider = await this._getKeylessTerrainProvider();
      if (gen != null && gen !== this._switchGen) return;
      this.viewer.terrainProvider = provider;
    }
    this._terrainMode = targetMode;
  }

  async _getKeylessTerrainProvider() {
    if (this._reearthTerrainProvider) return this._reearthTerrainProvider;
    try {
      this._reearthTerrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(REEARTH_TERRAIN_URL);
    } catch (error) {
      console.warn('[mapStack] Re:Earth terrain unavailable, using flat terrain:', error);
      this._reearthTerrainProvider = new Cesium.EllipsoidTerrainProvider();
    }
    return this._reearthTerrainProvider;
  }

  _emitChange(status) { this._onChange?.(this.getState(status)); }
}
