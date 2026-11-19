import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Tiny service-worker helper (no extra dependency): after the build, it writes
 * the list of generated files into dist/sw.js so the whole app is precached
 * and opens offline on the next launch.
 */
function precacheManifest(): Plugin {
  let outDir = 'dist';
  let list: string[] = ['./'];
  const version = Date.now().toString(36);
  const publicFiles = [
    'manifest.webmanifest',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/apple-touch-icon.png',
    'icons/icon-512-maskable.png',
  ];
  return {
    name: 'liftlog-precache',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      list = ['./', ...files.map((f) => `./${f}`), ...publicFiles.map((f) => `./${f}`)];
    },
    closeBundle() {
      const swPath = resolve(outDir, 'sw.js');
      try {
        const src = readFileSync(swPath, 'utf8')
          .replace('__PRECACHE_LIST__', JSON.stringify(list))
          .replace('__CACHE_VERSION__', version);
        writeFileSync(swPath, src);
      } catch {
        /* sw.js missing — nothing to do */
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), precacheManifest()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0'),
  },
});
