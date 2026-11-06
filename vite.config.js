import { createReadStream, cpSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { defineConfig } from 'vite';

// Cesium needs its Workers/Assets/ThirdParty/Widgets folders served as plain static
// files. A well-known plugin does this, but a 40-line local one is one less
// third-party maintainer in the supply chain. (Cesium docs: "Using CesiumJS with Vite".)
const require = createRequire(import.meta.url);
const CESIUM_BUILD = join(dirname(require.resolve('cesium/package.json')), 'Build', 'Cesium');
const CESIUM_DIRS = ['Assets', 'ThirdParty', 'Widgets', 'Workers'];
const MIME = { '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2' };

function cesiumAssets() {
  let outDir = 'dist';
  return {
    name: 'tc-cesium-assets',
    config: () => ({ define: { CESIUM_BASE_URL: JSON.stringify('/cesium') } }),
    configResolved(cfg) { outDir = resolve(cfg.root, cfg.build.outDir); },
    configureServer(server) {
      server.middlewares.use('/cesium', (req, res, next) => {
        let rel;
        try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return next(); }
        const [, top] = rel.split('/');
        if (!CESIUM_DIRS.includes(top) || rel.split('/').some((s) => s === '..' || s.startsWith('.'))) return next();
        const file = resolve(CESIUM_BUILD, `.${rel}`);
        if (!file.startsWith(CESIUM_BUILD + sep)) return next();
        try { if (!statSync(file).isFile()) return next(); } catch { return next(); }
        res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
    writeBundle() {
      for (const dir of CESIUM_DIRS) cpSync(join(CESIUM_BUILD, dir), join(outDir, 'cesium', dir), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [cesiumAssets()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Dev only: the API lives in server/ (run it with `pnpm dev`, which starts both).
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 8000 },
});
