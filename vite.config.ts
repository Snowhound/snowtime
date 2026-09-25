import { paraglideVitePlugin } from '@inlang/paraglide-js'
import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/solid-start/plugin/vite'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    // Options in project.inlang/paraglide.config.ts, shared with `bun run i18n:compile`.
    paraglideVitePlugin({ project: './project.inlang' }),
    nitro({
      // Files in public/ keep their names, so they can't be immutable like the hashed /assets/.
      // A week covers repeat visits, so a changed image needs a new name (-01, -02).
      routeRules: {
        '/backgrounds/**': { headers: { 'cache-control': 'public, max-age=604800' } },
        '/brand/**': { headers: { 'cache-control': 'public, max-age=604800' } },
      },
    }),
    tailwindcss(),
    // src/server.ts is Start's default, which would sit beside the src/server/ folder.
    tanstackStart({ server: { entry: 'server-entry' } }),
    solidPlugin({ ssr: true }),
  ],
})
