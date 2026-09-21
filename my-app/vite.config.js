// vite.config.js
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const timestamp = new Date().getTime();

const generateVersion = () => {
  const now = new Date();
  const year = now.getFullYear() - 2017; // Year since 2017
  const month = now.getMonth() + 1;      // Current month (1-12)
  const day = now.getDate();             // Current day

  // Pad the month/day with leading zero if needed, then join
  return `${year}.${month}.${day}`;
};

// Generate the version string once for this build
const BUILD_VERSION = generateVersion();

// Every environment-specific value below has a working default, so a fresh
// clone builds and runs without editing this file. Overrides go in
// .env.local (git-ignored). See "Configuration" in the README.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // Where the backend actually lives. Used only for the dev-server proxy.
  //
  // Derived from VITE_API_BASE_URL when that is an absolute URL, so there is
  // a single source of truth. When VITE_API_BASE_URL is relative (the
  // recommended '/api'), requests go through the proxy to this target.
  const apiBase = env.VITE_API_BASE_URL || '/api';
  const derivedTarget = /^https?:\/\//.test(apiBase)
    ? new URL(apiBase).origin
    : null;

  const PROXY_TARGET = env.VITE_PROXY_TARGET || derivedTarget || 'http://localhost:3009';
  const WS_TARGET    = env.VITE_WS_URL || PROXY_TARGET.replace(/^http/, 'ws');
  const OUT_DIR      = env.VITE_OUT_DIR || 'dist';
  const DEV_PORT     = Number(env.VITE_DEV_PORT || 5173);

  return {
    plugins: [
      vue(),
      tailwindcss(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.js',
        registerType: 'autoUpdate',
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        },
        includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
        manifest: {
          name: 'Wolffie Energy Manager',
          start_url: '/',
          short_name: 'Wolffie',
          description: 'your Watts OnLine/oFFline Energy management system',
          theme_color: '#ffffff',
          background_color: '#ffffff',
          display: 'standalone',
          scope: '/',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'pwa-512x512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ]
        }
      })
    ],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        //'@fortawesome': path.resolve(__dirname, 'node_modules/@fortawesome'),
        // vue-i18n ships an ESM build that relies on runtime template
        // compilation; the CJS build avoids that and keeps the bundle smaller.
        'vue-i18n': 'vue-i18n/dist/vue-i18n.cjs.js',
      },
    },
    define: {
      // The value must be JSON-stringified for Vite/Rollup
      '__APP_VERSION__': JSON.stringify(BUILD_VERSION), 
    },

    server: {
      port: DEV_PORT,
      proxy: {
        // Only used when VITE_API_BASE_URL is relative ('/api'). If it is an
        // absolute URL the browser calls the backend directly and these rules
        // never fire — in which case the backend must send CORS headers.
        '/api': { target: PROXY_TARGET, changeOrigin: true },
        '/ws':  { target: WS_TARGET,    ws: true },
      },
    },

    build: {
      outDir: OUT_DIR,
      emptyOutDir: true,
      rollupOptions: {
        output: {
          // Timestamped filenames bust the browser and service-worker cache on
          // every deploy — without this the PWA can serve a stale bundle.
          entryFileNames: `assets/[name]-${timestamp}.js`,
          chunkFileNames: `assets/[name]-${timestamp}.js`,
          assetFileNames: `assets/[name]-${timestamp}.[ext]`,
          manualChunks: {
            vendor: ['vue', 'vue-router', 'pinia'],
            charts: ['chart.js'],
            i18n:   ['vue-i18n'],
          }
        }
      }
    }
  };
});