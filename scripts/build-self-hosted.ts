// Builds the app for a self-hosted Linux server (docs/deployment/self-hosted.md): Nitro's bun
// preset, with the text files in .output/public precompressed for Caddy's file_server.
// With --binary, it also compiles one release per Linux architecture into
// dist/snowtime-linux-<arch>/: the server and the migrator as executables, plus drizzle/ and
// public/. A release needs no Bun on the server.
//
// Usage:
//   bun run build:self-hosted
//   bun run build:binary [--target=x64|arm64 ...] [--no-build]

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { extname, join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { brotliCompressSync, constants, gzipSync, zstdCompressSync } from 'node:zlib'

const ROOT = join(import.meta.dir, '..')
const OUTPUT = join(ROOT, '.output')
const DIST = join(ROOT, 'dist')
const TARGETS = ['x64', 'arm64'] as const
type Arch = (typeof TARGETS)[number]

const { values } = parseArgs({
  options: {
    binary: { type: 'boolean', default: false },
    target: { type: 'string', multiple: true },
    build: { type: 'boolean', default: true },
  },
  allowNegative: true,
})

function fail(message: string): never {
  console.error(`[build] ${message}`)
  process.exit(1)
}

const targets = (values.target ?? (values.binary ? TARGETS : [])) as Arch[]
for (const arch of targets) {
  if (!TARGETS.includes(arch)) fail(`Unknown target ${arch}; use ${TARGETS.join(' or ')}.`)
}

// Nitro traces only this machine's libSQL addon into .output, so a binary for another
// platform takes the addon from node_modules. Bun installs only the host's by default.
function libsqlPackage(arch: Arch): string {
  const name = `@libsql/linux-${arch}-gnu`
  if (!existsSync(join(ROOT, 'node_modules', name, 'index.node'))) {
    fail(`${name} is missing. Install it with: bun install --os=linux --cpu=${arch}`)
  }
  return name
}
const addons = new Map(targets.map((arch) => [arch, libsqlPackage(arch)]))

if (values.build) {
  const result = spawnSync('bunx', ['--bun', 'vite', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production', NITRO_PRESET: 'bun' },
  })
  if (result.status !== 0) fail('vite build failed.')
  precompress(join(OUTPUT, 'public'))
}

// Caddy serves a file's .zst, .br, or .gz sibling to a browser that accepts it. Stock Caddy
// can't compress to brotli on the fly, and precompressing uses the highest levels once.
function precompress(folder: string) {
  const compressible = new Set([
    '.js',
    '.mjs',
    '.css',
    '.html',
    '.json',
    '.svg',
    '.txt',
    '.xml',
    '.webmanifest',
    '.ico',
  ])
  let files = 0
  let before = 0
  let after = 0
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name)
    if (!entry.isFile() || !compressible.has(extname(entry.name))) continue
    const data = readFileSync(path)
    if (data.length < 1024) continue
    const variants: [string, Buffer][] = [
      ['.zst', zstdCompressSync(data, { params: { [constants.ZSTD_c_compressionLevel]: 19 } })],
      ['.br', brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })],
      ['.gz', gzipSync(data, { level: 9 })],
    ]
    for (const [suffix, compressed] of variants) {
      if (compressed.length < data.length) writeFileSync(path + suffix, compressed)
    }
    files++
    before += data.length
    after += variants[1][1].length
  }
  console.log(
    `[build] Precompressed ${files} files in ${relative(ROOT, folder)}: ${kb(before)} to ${kb(after)} as brotli`,
  )
}

function kb(bytes: number) {
  return `${Math.round(bytes / 1024)} KB`
}

// libsql/index.js picks its addon with require(`@libsql/${target}`), which the bundler can't
// follow, so the executable would fail with "Cannot find module". A literal name lets Bun
// embed the target's .node file.
function libsqlPlugin(addon: string): Bun.BunPlugin {
  return {
    name: 'libsql-addon',
    setup(build) {
      build.onLoad({ filter: /node_modules\/libsql\/index\.js$/ }, async (args) => {
        const source = await Bun.file(args.path).text()
        const call = 'return require(`@libsql/${target}`);'
        if (!source.includes(call)) fail(`${args.path} no longer loads its addon as expected.`)
        return {
          contents: source.replace(call, `return require(${JSON.stringify(addon)});`),
          loader: 'js',
        }
      })
    },
  }
}

// Bytecode saves the server parsing its 15 MB of JavaScript at each start, so a restart
// holds requests for less time. The migrator runs once per deploy and skips it.
// Profile-guided bytecode layout (--bytecode-order) saved 10 ms of a 120 ms start and no
// memory (task 075), which isn't worth a profiling run per build.
async function compile(entry: string, outfile: string, arch: Arch, bytecode = false) {
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'bun',
    format: 'esm',
    minify: true,
    bytecode,
    compile: {
      target: `bun-linux-${arch}`,
      outfile,
      // Settings come from the systemd unit's EnvironmentFile, never from files in the
      // working directory.
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
    plugins: [libsqlPlugin(addons.get(arch)!)],
  })
  if (!result.success)
    fail(`Compiling ${relative(ROOT, entry)} failed:\n${result.logs.map(String).join('\n')}`)
}

for (const arch of targets) {
  if (!existsSync(join(OUTPUT, 'server/index.mjs')))
    fail('No build in .output; run without --no-build.')
  const release = join(DIST, `snowtime-linux-${arch}`)
  rmSync(release, { recursive: true, force: true })
  mkdirSync(release, { recursive: true })
  await compile(join(ROOT, 'scripts/start-self-hosted.ts'), join(release, 'snowtime'), arch, true)
  await compile(
    join(ROOT, 'scripts/db-migrate-release.ts'),
    join(release, 'snowtime-migrate'),
    arch,
  )
  await compile(join(ROOT, 'scripts/db-seed.ts'), join(release, 'snowtime-seed'), arch)
  await compile(join(ROOT, 'scripts/db-import.ts'), join(release, 'snowtime-import'), arch)
  cpSync(join(ROOT, 'drizzle'), join(release, 'drizzle'), { recursive: true })
  cpSync(join(OUTPUT, 'public'), join(release, 'public'), { recursive: true })
  const size = statSync(join(release, 'snowtime')).size
  console.log(`[build] ${relative(ROOT, release)}: snowtime ${Math.round(size / 1024 / 1024)} MB`)
}
