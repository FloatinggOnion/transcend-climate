// The controller: the one place where actions are applied to the app.
// Buttons, shared links and natural-language commands all end up here, and
// every action is re-validated first (the server already validated it; the
// browser never relies on that).

import { clampDate } from '../shared/catalog.js';
import { validateClientAction } from '../shared/actions.js';
import { createGazetteer } from '../shared/gazetteer.js';
import gazetteerData from '../shared/gazetteer.json';
import { currentView, flyTo } from './engine/viewer.js';
import { DEFAULT_VIEW } from './state.js';

export const gazetteer = createGazetteer(gazetteerData);

/** Region shortcuts shown in the "Go to" list (camera framings, not data claims). */
export const REGIONS = [
  { id: 'nigeria', lat: 9.08, lon: 8.68, altKm: 1800 },
  { id: 'west_africa', lat: 10.0, lon: 0.0, altKm: 4200 },
  { id: 'sahel', lat: 14.0, lon: 5.0, altKm: 4500 },
  { id: 'lake_chad', lat: 13.0, lon: 14.3, altKm: 700 },
  { id: 'niger_delta', lat: 5.0, lon: 6.2, altKm: 450 },
  { id: 'lagos', lat: 6.52, lon: 3.38, altKm: 120 },
  { id: 'abuja', lat: 9.07, lon: 7.4, altKm: 120 },
  { id: 'africa', lat: 2.0, lon: 20.0, altKm: 9500 },
  { id: 'east_africa', lat: -1.0, lon: 36.0, altKm: 2600 },
  { id: 'horn', lat: 8.0, lon: 45.0, altKm: 2600 },
  { id: 'congo', lat: -1.0, lon: 22.0, altKm: 3200 },
  { id: 'southern_africa', lat: -20.0, lon: 25.0, altKm: 3500 },
];

export function createController({ viewer, store, layers, mapStack, annotations, hooks }) {
  /** Effective date for the daily satellite-photo basemap. */
  function basemapDate() {
    const m = layers.meta['true-color'];
    const s = store.get();
    return m?.end ? clampDate(s.date ?? m.end, m.start, m.end) : s.date;
  }

  async function syncBasemap() {
    const s = store.get();
    const result = await mapStack.setStack(s.basemap, { silent: true });
    if (result.activeId !== s.basemap) {
      // The requested stack isn't available on this server: tell the user, and keep state truthful.
      const stack = mapStack.getStack(s.basemap);
      hooks.unavailableBasemap(stack);
      store.set({ basemap: result.activeId });
    }
  }

  store.subscribe((s, prev, changed) => {
    if (changed.includes('basemap')) syncBasemap();
    if (changed.includes('date')) mapStack.setDate(basemapDate());
    if (changed.includes('reference')) mapStack.setReferenceVisible(s.reference);
    if (changed.includes('dataSaver')) { mapStack.setTerrainSource(s.dataSaver ? 'flat' : 'reearth'); hooks.dataSaver(s.dataSaver); }
  });
  layers.onChange((id) => { if (id === '*') mapStack.setDate(basemapDate()); });

  function setLayers(list, mode) {
    const cur = store.get().layers;
    let next;
    if (mode === 'replace') next = list;
    else if (mode === 'remove') next = cur.filter((id) => !list.includes(id));
    else next = [...cur, ...list.filter((id) => !cur.includes(id))];
    store.set({ layers: [...new Set(next)] });
  }

  const handlers = {
    async fly_to(a) { await flyTo(viewer, a); store.set({ view: currentView(viewer) }); },
    set_layers(a) { setLayers(a.layers, a.mode); },
    set_date(a) { store.set({ date: a.date }); },
    set_basemap(a) { store.set({ basemap: a.basemap }); },
    annotate(a) { return annotations.add(a); },
    clear_annotations() { annotations.clear(); },
    show_emissions(a) {
      store.set({ emissions: { country: a.country, sector: a.sector } });
      setLayers(['emissions'], 'add');
    },
    set_language(a) { return hooks.setLanguage(a.language); },
    open_climate_card(a) { hooks.openClimateCard({ lat: a.lat, lon: a.lon, label: a.label }); },
  };

  return {
    gazetteer,
    layers,
    basemapDate,

    /** Validate then apply a batch from the NLP service. Returns the number applied. */
    async applyActions(raw) {
      const actions = (Array.isArray(raw) ? raw : []).map(validateClientAction).filter(Boolean).slice(0, 8);
      const flies = actions.some((a) => a.type === 'fly_to' || a.type === 'open_climate_card');
      for (const a of actions) {
        try { await handlers[a.type](a); } catch (err) { console.warn('[action]', a.type, err); }
      }
      // "Show emissions in Ghana" with no explicit move: take the user there.
      const em = actions.find((a) => a.type === 'show_emissions');
      if (em && !flies) {
        const c = gazetteer.country(em.country);
        if (c) await flyTo(viewer, { lat: c.lat, lon: c.lon, altKm: c.altKm });
      }
      return actions.length;
    },

    flyToRegion(region) { return flyTo(viewer, region); },
    resetView() { return flyTo(viewer, DEFAULT_VIEW); },

    /** "Near Kano, Nigeria (12 km)" for an arbitrary coordinate; null over open ocean. */
    describePlace(lat, lon) {
      const n = gazetteer.nearest(lat, lon, { maxKm: 600 });
      return n ? { place: n.place.name, country: n.country?.name ?? n.place.country, km: Math.round(n.km) } : null;
    },
  };
}
