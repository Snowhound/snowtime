import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'vite'
import solid from 'vite-plugin-solid'

const root = resolve(import.meta.dir, '../../../..')
const routeTreePath = resolve(root, 'src/routeTree.gen.ts')
const routeTree = readFileSync(routeTreePath, 'utf8')
try {
  await build({
    root,
    configFile: false,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    resolve: {
      alias: [
        { find: '~', replacement: resolve(root, 'src') },
        {
          find: /^@tanstack\/solid-start$/,
          replacement: resolve(import.meta.dir, 'start-stub.ts'),
        },
      ],
      conditions: ['solid', 'node'],
    },
    plugins: [
      tailwindcss(),
      {
        name: 'exclude-api-routes',
        enforce: 'pre',
        transform(code, id) {
          if (!id.endsWith('/src/routeTree.gen.ts')) return null
          return code
            .replace(/const Api(?:Auth|V1|Bench)\w+ = [\s\S]*?\} as any\)\n/g, '')
            .split('\n')
            .filter((line) => !/Api(Auth|V1|Bench)/.test(line))
            .join('\n')
        },
      },
      tanstackRouter({ target: 'solid', autoCodeSplitting: true }),
      solid({ ssr: true }),
    ],
    build: {
      ssr: resolve(import.meta.dir, 'entry.tsx'),
      outDir: resolve(import.meta.dir, 'dist'),
      emptyOutDir: true,
      minify: false,
      rolldownOptions: { output: { format: 'iife', entryFileNames: 'render.js' } },
    },
    ssr: { noExternal: true },
  })
} finally {
  writeFileSync(routeTreePath, routeTree)
}
