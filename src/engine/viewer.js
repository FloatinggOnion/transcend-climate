// Cesium viewer bootstrap. Pattern adapted from God's Eye View's main.js
// (MIT, (c) 2026 Bilawal Sidhu; upstream commit 880a672b): minimal chrome,
// a visible credit container, a capped frame rate, and idle render governing.
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { installRenderGovernor, governorRequestRender } from './renderGovernor.js';
import { prefersReducedMotion } from '../ui/dom.js';

export function createViewer(container, { creditContainer, dataSaver = false, onRenderError = () => {} } = {}) {
  // CesiumWidget is Cesium's core 3D view WITHOUT the Viewer chrome. We use it
  // deliberately: Viewer pulls in Knockout.js, which evaluates `eval('this')` at
  // load time and therefore cannot run under a CSP without 'unsafe-eval'. Our own
  // accessible UI replaces every Viewer widget anyway.
  const viewer = new Cesium.CesiumWidget(container, {
    baseLayer: false, // the map stack installs its own imagery
    creditContainer,
    msaaSamples: dataSaver ? 1 : 4,
    contextOptions: { webgl: { alpha: false } },
    showRenderLoopErrors: false, // we show a friendly message instead of a raw error panel
    automaticallyTrackDataSourceClocks: false,
    targetFrameRate: 60,
  });
  viewer.scene.renderError.addEventListener((_scene, error) => onRenderError(error));

  const { scene } = viewer;
  scene.globe.enableLighting = false; // even illumination: data colours must be readable everywhere
  scene.globe.baseColor = Cesium.Color.fromCssColorString('#0c1822');
  scene.backgroundColor = Cesium.Color.fromCssColorString('#05090d');
  scene.skyAtmosphere.show = true;
  scene.globe.showGroundAtmosphere = true;
  scene.globe.maximumScreenSpaceError = dataSaver ? 4 : 2;
  scene.screenSpaceCameraController.minimumZoomDistance = 500; // metres
  scene.screenSpaceCameraController.enableTilt = true;

  installRenderGovernor(viewer);
  // Pause rendering while the tab is hidden: nobody is looking, and the GPU shouldn't burn.
  const onVisibility = () => { viewer.useDefaultRenderLoop = !document.hidden; if (!document.hidden) governorRequestRender('visibility'); };
  document.addEventListener('visibilitychange', onVisibility);
  return viewer;
}

export function setDataSaver(viewer, on) {
  viewer.scene.globe.maximumScreenSpaceError = on ? 4 : 2;
  governorRequestRender('data-saver');
}

/** Camera → {lat, lon, altKm}, using the ground point under the screen centre when available. */
export function currentView(viewer) {
  const cam = viewer.camera;
  const carto = cam.positionCartographic;
  let lat = Cesium.Math.toDegrees(carto.latitude);
  let lon = Cesium.Math.toDegrees(carto.longitude);
  try {
    const canvas = viewer.scene.canvas;
    const ray = cam.getPickRay(new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
    const hit = ray && viewer.scene.globe.pick(ray, viewer.scene);
    if (hit) {
      const c = Cesium.Cartographic.fromCartesian(hit);
      lat = Cesium.Math.toDegrees(c.latitude); lon = Cesium.Math.toDegrees(c.longitude);
    }
  } catch { /* fall back to camera position */ }
  return { lat, lon, altKm: Math.max(0.05, carto.height / 1000) };
}

/** Visible rectangle in degrees, or null (e.g. camera sees no ground). */
export function viewRectangle(viewer) {
  const r = viewer.camera.computeViewRectangle();
  if (!r) return null;
  return { west: Cesium.Math.toDegrees(r.west), south: Cesium.Math.toDegrees(r.south), east: Cesium.Math.toDegrees(r.east), north: Cesium.Math.toDegrees(r.north) };
}

/**
 * Fly to a point, looking straight down from `altKm`. Honors reduced-motion by jumping.
 * @returns {Promise<void>} resolves when the move finishes (or is cancelled)
 */
export function flyTo(viewer, { lat, lon, altKm }, { duration = 2.4 } = {}) {
  const destination = Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(500, altKm * 1000));
  const orientation = { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 };
  if (prefersReducedMotion() || duration === 0) {
    viewer.camera.setView({ destination, orientation });
    governorRequestRender('fly-to');
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    viewer.camera.flyTo({
      destination, orientation, duration,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      complete: resolve, cancel: resolve,
    });
  });
}

