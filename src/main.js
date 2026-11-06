import { apiGet } from './api.js';
import { createController, gazetteer } from './app.js';
import { MapStack } from './engine/mapStack.js';
import * as Cesium from 'cesium';
import { createViewer, currentView, flyTo, setDataSaver } from './engine/viewer.js';
import { i18n, t } from './i18n/index.js';
import { Annotations } from './layers/annotations.js';
import { LayerManager } from './layers/manager.js';
import { ReferenceOverlay } from './layers/reference.js';
import { createStore, decodeHash, defaultState, encodeHash } from './state.js';
import { mountCards } from './ui/cards.js';
import { mountChat } from './ui/chat.js';
import { mountPanel } from './ui/panel.js';
import { mountTimebar } from './ui/timebar.js';
import { mountTopbar } from './ui/topbar.js';
import { pickLanguage, getLanguage } from '../shared/languages.js';
import './styles.css';

const $ = (id) => document.getElementById(id);
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode / blocked: fine */ } },
};

/** Static text in index.html (loading screen, noscript) uses data-i18n; refresh it when the language changes. */
function translateStatic() {
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  const info = i18n.info();
  document.documentElement.lang = info.code;
  document.documentElement.dir = info.dir;
  document.title = `${t('app.name')} — ${t('app.tagline')}`;
}

function fail(messageKey, detail) {
  const el = $('loading');
  el.classList.add('error');
  el.querySelector('.loading-text').textContent = t(messageKey);
  if (detail) console.error('[startup]', detail);
}

async function main() {
  // 1. Language first, so even startup errors are readable.
  const fromHash = decodeHash(location.hash);
  const saved = storage.get('tc.lang');
  await i18n.setLanguage(fromHash.lang ?? (getLanguage(saved) ? saved : pickLanguage(navigator.languages ?? [navigator.language])));
  translateStatic();

  // 2. Server config (map keys, which optional features exist). A missing server must not blank the app.
  let config;
  try { config = await apiGet('/api/config', { timeoutMs: 8000 }); } catch {
    config = { features: { nlp: { mode: 'offline', provider: 'offline' }, openaq: false, geocoder: false, googleMaps: false, cesiumIon: false }, keys: {}, terrain: 'reearth', limits: { nlpMaxChars: 800 } };
  }

  // 3. Initial state: defaults < saved preferences < the shared link.
  const initial = { ...defaultState(), ...fromHash, lang: i18n.getLanguage() };
  if (!fromHash.view) initial.view = defaultState().view;
  if (storage.get('tc.datasaver') === '1' && fromHash.dataSaver === undefined) initial.dataSaver = true;
  const store = createStore(initial);

  // 4. Globe.
  let viewer;
  try {
    viewer = createViewer($('globe'), { creditContainer: $('credits'), dataSaver: initial.dataSaver, onRenderError: (e) => console.error('[render]', e) });
  } catch (err) { return fail(err?.message?.toLowerCase().includes('webgl') ? 'loading.webgl' : 'loading.error', err); }
  if (config.keys.cesiumIonToken) Cesium.Ion.defaultAccessToken = config.keys.cesiumIonToken;

  const mapStack = new MapStack(viewer, {
    cesiumToken: config.keys.cesiumIonToken ?? '', terrain: initial.dataSaver ? 'flat' : config.terrain,
    initialStack: initial.basemap, date: initial.date,
    onError: (message) => console.warn('[mapStack]', message),
  });
  const reference = new ReferenceOverlay(viewer, { gazetteer, getLang: () => i18n.getLanguage() });
  mapStack.attachReference(reference);
  mapStack.setReferenceVisible(initial.reference);
  i18n.onChange(() => reference.relabel());
  await mapStack.setStack(initial.basemap, { silent: true });

  await flyTo(viewer, initial.view, { duration: 0 });

  // 5. Layers, annotations, controller, UI.
  const layers = new LayerManager({ viewer, mapStack, store });
  const annotations = new Annotations(viewer);
  let cards; // assigned below; hooks reference it lazily

  const setLanguage = async (code) => {
    await i18n.setLanguage(code);
    storage.set('tc.lang', i18n.getLanguage());
    store.set({ lang: i18n.getLanguage() });
    translateStatic();
  };
  const controller = createController({
    viewer, store, layers, mapStack, annotations,
    hooks: {
      setLanguage,
      openClimateCard: (a) => cards.openClimate(a),
      unavailableBasemap: (stack) => cards.toast(t('map.unavailable', { name: t({ 'bing-aerial': 'map.bing', photoreal: 'map.photoreal', osm: 'map.osm' }[stack?.id] ?? 'map.bluemarble') })),
      dataSaver: (on) => { storage.set('tc.datasaver', on ? '1' : '0'); setDataSaver(viewer, on); },
    },
  });

  cards = mountCards({ cardsRoot: $('cards'), toastsRoot: $('toasts'), i18n, controller });
  mountTopbar({ root: $('topbar'), i18n, onLanguage: setLanguage, onAbout: () => cards.openAbout() });
  mountPanel({ root: $('panel'), store, layers, controller, i18n, config });
  mountTimebar({ root: $('timebar'), store, layers, i18n });
  mountChat({ root: $('chat'), store, controller, i18n, viewer, config });

  // 6. Picking: click a facility/station/anywhere for details.
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    const id = picked?.id;
    if (id?.kind === 'facility') return cards.openFacility(id);
    if (id?.kind === 'station') return cards.openStation(id);
    const ray = viewer.camera.getPickRay(click.position);
    const hit = ray && viewer.scene.globe.pick(ray, viewer.scene);
    if (!hit) return cards.close();
    const c = Cesium.Cartographic.fromCartesian(hit);
    return cards.openPoint(Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude));
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // 7. Keep the URL a live, shareable link (debounced; replaceState so Back isn't polluted).
  viewer.camera.moveEnd.addEventListener(() => store.set({ view: currentView(viewer) }));
  let hashTimer;
  store.subscribe((s) => {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => { try { history.replaceState(null, '', `#${encodeHash(s)}`); } catch { /* sandboxed */ } }, 400);
  });

  layers.start();
  layers.loadMeta(); // non-blocking: layers use a safe fallback date until this arrives
  $('loading').classList.add('hidden');
  window.__tc = import.meta.env.DEV ? { viewer, store, layers, controller, mapStack, Cesium } : undefined;
}

main().catch((err) => fail('loading.error', err));
