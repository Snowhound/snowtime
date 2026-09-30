// Bundle budgets read from a production build: gzipped JS per route, gzipped CSS, and the
// server bundle, whose size sets the function's cold start.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import {
  change,
  readBaseline,
  type Result,
  table,
  withinTolerance,
  writeBaseline,
} from './baseline'

const ROUTES = [
  '/sign-in',
  '/$org/timer',
  '/$org/reports',
  '/$org/settings',
  '/$org/projects',
  '/$org/organization',
] as const

interface Budgets {
  jsGzip: Record<string, number>
  // Gzipped size of each JS chunk by name without its hash, so a failure can say which
  // chunks grew: a new feature's own chunk is expected, growth in the entry is not.
  chunks: Record<string, number>
  cssGzip: number
  server: number
}

interface StartManifest {
  routes: Record<string, { preloads?: string[]; scripts?: { attrs: { src: string } }[] }>
}

function fromUrl(url: string) {
  return url.replace(/^\/assets\//, '')
}

function hashless(name: string) {
  return name.replace(/-[\w-]{8}\.(m?js)$/, '.$1')
}

function gzipSize(path: string): number {
  return gzipSync(readFileSync(path), { level: 9 }).length
}

function walk(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}

// Static imports only: `import"./x.js"`, `from"./x.js"`. A dynamic import( has a parenthesis
// and is its own lazy load.
function staticImports(assets: string, file: string): string[] {
  const source = readFileSync(join(assets, file), 'utf8')
  const found = new Set<string>()
  for (const match of source.matchAll(/(?:\bfrom|\bimport)\s*["']\.\/([^"']+\.js)["']/g)) {
    found.add(match[1])
  }
  return [...found]
}

// The route's files: the client entry and preloads of the root and of its parent routes, the
// route's own, and everything those import statically. The manifest is TanStack Start's, in
// the server build.
async function routeFiles(build: string): Promise<Record<string, string[]>> {
  const manifestFile = readdirSync(join(build, 'server')).find((f) =>
    f.startsWith('_tanstack-start-manifest'),
  )
  if (!manifestFile) throw new Error('[perf] No TanStack Start manifest in the server build')
  const module = await import(pathToFileURL(join(build, 'server', manifestFile)).href)
  const { routes } = module.tsrStartManifest() as StartManifest
  const assets = join(build, 'public/assets')

  const result: Record<string, string[]> = {}
  for (const route of ROUTES) {
    const chain = ['__root__', ...(route.startsWith('/$org/') ? ['/$org'] : []), route]
    const roots = chain.flatMap((id) => [
      ...(routes[id]?.scripts?.map((s) => s.attrs.src) ?? []),
      ...(routes[id]?.preloads ?? []),
    ])
    if (!routes[route]) throw new Error(`[perf] Route ${route} is not in the manifest`)
    const seen = new Set<string>()
    const queue = roots.map(fromUrl)
    for (let file = queue.pop(); file; file = queue.pop()) {
      if (seen.has(file) || !existsSync(join(assets, file))) continue
      seen.add(file)
      queue.push(...staticImports(assets, file))
    }
    result[route] = [...seen].sort()
  }
  return result
}

async function measureBudgets(build: string): Promise<Budgets & { biggest: string[] }> {
  const assets = join(build, 'public/assets')
  const files = await routeFiles(build)
  const jsGzip: Record<string, number> = {}
  for (const [route, list] of Object.entries(files)) {
    jsGzip[route] = list.reduce((sum, file) => sum + gzipSize(join(assets, file)), 0)
  }
  const chunks: Record<string, number> = {}
  for (const file of readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .sort()) {
    const name = hashless(file)
    chunks[name] = (chunks[name] ?? 0) + gzipSize(join(assets, file))
  }
  const cssGzip = readdirSync(assets)
    .filter((f) => f.endsWith('.css'))
    .reduce((sum, f) => sum + gzipSize(join(assets, f)), 0)

  // The traced native packages in server/node_modules don't change with the code.
  const server = join(build, 'server')
  const own = walk(server).filter((f) => !relative(server, f).startsWith('node_modules'))
  const sizes = own.map((f) => ({ name: relative(server, f), size: statSync(f).size }))
  sizes.sort((a, b) => b.size - a.size)
  return {
    jsGzip,
    chunks,
    cssGzip,
    server: sizes.reduce((sum, f) => sum + f.size, 0),
    biggest: sizes.slice(0, 4).map((f) => `${hashless(f.name)} ${f.size}`),
  }
}

// The chunks behind a failed budget. A chunk every route loads shows up in every route's
// number.
function printGrownChunks(baseline: Record<string, number>, current: Record<string, number>) {
  const rows = Object.entries(current)
    .filter(([name, size]) => size - (baseline[name] ?? 0) > 200)
    .sort(([a, x], [b, y]) => y - (baseline[b] ?? 0) - (x - (baseline[a] ?? 0)))
    .map(([name, size]) => [
      name,
      String(baseline[name] ?? '-'),
      String(size),
      change(baseline[name], size),
    ])
  if (rows.length === 0) return
  console.log('\nChunks that grew by more than 200 bytes (gzipped)')
  console.log(table(['', 'baseline', 'now', 'change'], rows))
}

export async function checkBudgets(build: string, update: boolean): Promise<Result> {
  const { biggest, ...current } = await measureBudgets(build)
  const baseline = readBaseline('budgets.json') as Budgets | null
  const failures: string[] = []
  const rows: string[][] = []

  function row(label: string, base: number | undefined, now: number) {
    const bad = baseline && base !== undefined && !withinTolerance(base, now)
    if (bad) failures.push(`${label} grew: ${base} to ${now} bytes`)
    rows.push([label, String(base ?? '-'), String(now), change(base, now), bad ? 'FAIL' : ''])
  }
  for (const [route, size] of Object.entries(current.jsGzip)) {
    row(`js gzip ${route}`, baseline?.jsGzip[route], size)
  }
  row('css gzip', baseline?.cssGzip, current.cssGzip)
  row('server bytes', baseline?.server, current.server)

  console.log('\nBundle budgets (bytes)')
  console.log(table(['', 'baseline', 'now', 'change', ''], rows))
  console.log(`Biggest server files: ${biggest.join(', ')}`)
  if (failures.length > 0) {
    printGrownChunks(baseline?.chunks ?? {}, current.chunks)
    console.log(
      'If the growth is expected (a new feature), accept it with `bun run perf --update` and\n' +
        'commit perf/baselines/budgets.json with the change, saying why.',
    )
  }
  if (update) writeBaseline('budgets.json', current)
  else if (!baseline) failures.push('No budgets.json baseline; run with --update')
  return { failures }
}
