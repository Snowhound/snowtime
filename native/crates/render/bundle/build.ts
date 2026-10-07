import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { cpSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { minifySync } from 'rolldown/utils'
import { build } from 'vite'
import solid from 'vite-plugin-solid'
import { lucideNodes } from './lucide-nodes'
import { sharedProps } from './shared-props'
import { serverProps } from './solid-props'

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
      serverProps(),
      lucideNodes(),
      sharedProps(),
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
      sourcemap: true,
      rolldownOptions: { output: { format: 'iife', entryFileNames: 'render.js' } },
    },
    ssr: { noExternal: true },
  })
} finally {
  writeFileSync(routeTreePath, routeTree)
}

// Minified with names kept, so profiles and serialized function sources stay readable. V8
// stores the script source in the snapshot at two bytes per character if any character is
// above U+00FF, so the output is ASCII; tagged templates keep their text, and the warning
// lists what is left so the source can escape it.
for (const name of ['render.js', 'render.shared.js']) {
  const path = resolve(import.meta.dir, 'dist', name)
  const mapPath = `${path}.map`
  const withMap = name === 'render.js'
  const result = minifySync(name, readFileSync(path, 'utf8'), {
    compress: true,
    mangle: false,
    codegen: { removeWhitespace: true, asciiOnly: true },
    sourcemap: withMap,
    ...(withMap && { inputMap: JSON.parse(readFileSync(mapPath, 'utf8')) }),
  })
  if (result.errors.length) throw new Error(`${name}: ${result.errors[0].message}`)
  writeFileSync(path, result.code)
  if (withMap && result.map) writeFileSync(mapPath, JSON.stringify(result.map))
  for (const match of result.code.matchAll(/[^\0-\xff]/gu)) {
    const at = match.index
    console.warn(`${name}: ${JSON.stringify(match[0])} in`, result.code.slice(at - 60, at + 20))
  }
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
// The same build's public files, which the host serves (EDGE_STATIC_DIR), so pages and assets match.
cpSync(resolve(root, '.output/public'), resolve(import.meta.dir, 'dist/public'), {
  recursive: true,
})
