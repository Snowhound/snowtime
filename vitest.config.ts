import solidPlugin from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'

// Component tests: `*.test.tsx`, in a DOM. Server and database tests are `*.test.ts` and
// run on `bun test` (bunfig.toml ignores the component tests). The Solid plugin is the
// one in vite.config.ts; the Start, Nitro and devtools plugins stay out, since components
// render here without a server.
export default defineConfig({
  // On Windows, Vitest fails to resolve the @solid-refresh import that hot reload adds.
  plugins: [solidPlugin({ hot: process.platform !== 'win32' })],
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
