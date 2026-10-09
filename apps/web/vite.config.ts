import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const SERVER = '../../packages/python/datawalk/server'

export default defineConfig(({ mode }) => ({
  base: './', // relative asset URLs: the build works from any path, including static export
  plugins: [react()],
  // `--mode viewer`: one script and one stylesheet without the editor, for static site and
  // single-file HTML exports. Python adds the report data and the theme assets.
  // `--mode viewer-lite`: the same without Plotly and Vega (2 MB instead of 7 MB), for
  // reports that have neither.
  ...(mode === 'viewer-lite'
    ? {
        resolve: {
          alias: Object.fromEntries(['plotly.js-dist-min', 'vega', 'vega-lite', 'vega-embed'].map((m) => [m, fileURLToPath(new URL('./src/export/missing.ts', import.meta.url))])),
        },
      }
    : {}),
  ...(mode === 'viewer' || mode === 'viewer-lite'
    ? {
        publicDir: false,
        build: {
          outDir: `${SERVER}/viewer`,
          emptyOutDir: mode === 'viewer', // the lite build runs second, into the same folder
          cssCodeSplit: false,
          modulePreload: false,
          chunkSizeWarningLimit: 20000,
          rollupOptions: {
            output: {
              codeSplitting: false,
              entryFileNames: mode === 'viewer' ? 'viewer.js' : 'viewer-lite.js',
              // three's default KTX2 transcoder URLs also land here; unused (loaders.ts sets the path).
              assetFileNames: (a) => (a.names[0]?.endsWith('.css') ? 'viewer.css' : 'unused-[name][extname]'),
            },
          },
        },
      }
    : {
        publicDir: '../../assets', // theme files and the asset library, served at the site root
        build: {
          outDir: `${SERVER}/static`,
          emptyOutDir: true,
          chunkSizeWarningLimit: 5000, // Plotly.js is one large lazy chunk
        },
      }),
  // Dev: run a report with `show(port=8765)`, then `npm run dev`.
  server: { proxy: { '/api': 'http://127.0.0.1:8765' } },
  test: { include: ['src/**/*.test.ts'] }, // e2e/ runs under Playwright
}))
