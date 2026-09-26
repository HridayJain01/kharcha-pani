import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  worker: { format: 'es' },
  plugins: [
    react(),
    tailwindcss(),
    {
      // ONNX Runtime's bundled 27 MB wasm is never fetched: transformers.js loads the runtime from jsDelivr
      // (see src/asr.worker.ts), so keep it out of dist.
      name: 'drop-unused-onnx-wasm',
      generateBundle(_, bundle) {
        for (const file of Object.keys(bundle)) if (file.endsWith('.wasm')) delete bundle[file];
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Kharcha Pani',
        short_name: 'Kharcha Pani',
        description: 'Log spends the lazy way. AI sorts them into fun categories.',
        theme_color: '#FFFBEF',
        background_color: '#FFFBEF',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          // same art: the coin sits inside the maskable safe zone
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // The offline-voice worker (~540 kB) is cached on first use instead of at install.
        // Its model and runtime cache themselves (transformers.js uses Cache Storage).
        globIgnores: ['**/asr.worker-*.js'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/asr\.worker-[\w-]+\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'voice-worker', expiration: { maxEntries: 2 } },
          },
          // Google Fonts: cached on first online visit, then served offline.
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
});
