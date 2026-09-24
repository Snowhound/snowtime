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
    nitro(),
    tailwindcss(),
    // src/server.ts is Start's default, which would sit beside the src/server/ folder.
    tanstackStart({ server: { entry: 'server-entry' } }),
    solidPlugin({ ssr: true }),
  ],
})
