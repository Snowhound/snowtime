import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tailwindcss from '@tailwindcss/vite'

import { tanstackStart } from '@tanstack/solid-start/plugin/vite'

import solidPlugin from 'vite-plugin-solid'
import { nitro } from 'nitro/vite'
import { paraglideVitePlugin } from '@inlang/paraglide-js'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    // Options in project.inlang/paraglide.config.ts, shared with `bun run i18n:compile`.
    paraglideVitePlugin({ project: './project.inlang' }),
    nitro(),
    tailwindcss(),
    tanstackStart(),
    solidPlugin({ ssr: true }),
  ],
})
