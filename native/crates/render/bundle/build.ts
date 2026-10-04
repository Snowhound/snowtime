import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { cpSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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
    publicDir: false,
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

// The client manifest of the app build in .output (`bun run build`); the renderer embeds it
// with the bundle.
const output = resolve(root, '.output/server')
const file = readdirSync(output).find((name) => name.startsWith('_tanstack-start-manifest_'))
if (!file) throw new Error('Build the app first: bun run build')
const { tsrStartManifest } = await import(resolve(output, file))
// What Start's getStartManifest sends the client: each route's assets, without build paths.
const { routes, scriptFormat, inlineCss } = tsrStartManifest()
const manifest = {
  ...(scriptFormat && { scriptFormat }),
  ...(inlineCss && { inlineCss }),
  routes: Object.fromEntries(
    Object.entries(routes as Record<string, Record<string, unknown[] | undefined>>).flatMap(
      ([id, { preloads, scripts, css }]) => {
        const route = {
          ...(preloads?.length && { preloads }),
          ...(scripts?.length && { scripts }),
          ...(css?.length && { css }),
        }
        return Object.keys(route).length ? [[id, route]] : []
      },
    ),
  ),
}
writeFileSync(resolve(import.meta.dir, 'dist/manifest.json'), JSON.stringify(manifest))
// The same build's public files, which the host serves (PUBLIC_DIR), so pages and assets match.
cpSync(resolve(root, '.output/public'), resolve(import.meta.dir, 'dist/public'), {
  recursive: true,
})
