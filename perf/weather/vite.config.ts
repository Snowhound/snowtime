// Serves the weather bench (perf/weather.html) with the app's weather code and glass CSS, without
// TanStack Start and Nitro. perf/weather.ts starts it.
import tailwindcss from '@tailwindcss/vite'
import { join } from 'node:path'
import { defineConfig } from 'vite'

const ROOT = join(import.meta.dirname, '../..')

export default defineConfig({
  root: join(ROOT, 'perf'),
  publicDir: join(ROOT, 'public'),
  cacheDir: join(ROOT, 'perf/.cache/vite'),
  resolve: { alias: { '~': join(ROOT, 'src') } },
  plugins: [tailwindcss()],
  // Cross-origin isolation gives performance.now() microseconds instead of 0.1 ms steps.
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // Every import is ESM, so there's nothing to prebundle, and a mid-run prebundle would reload
  // the page.
  optimizeDeps: { noDiscovery: true, include: [] },
  logLevel: 'warn',
})
