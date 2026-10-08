import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { startApp } from '../../../perf/lib/app'
import { CACHE, ROOT } from '../../../perf/lib/database'
import type { BenchUser } from '../../../perf/stress/dataset'
import { dataset } from '../../../perf/stress/dataset'
import { checkOtherSessions, reserveStack } from '../../../perf/stress/lock'
import { record } from '../../../perf/stress/record'
import { LOCAL_SECRET } from '../../../perf/stress/stack'

const { values } = parseArgs({
  options: {
    help: { type: 'boolean', default: false },
    prepare: { type: 'boolean', default: false },
    date: { type: 'string' },
    recording: { type: 'string' },
    from: { type: 'string', default: '10000' },
    reference: { type: 'string' },
  },
})
if (values.help) {
  console.log(
    'kit-baseline.ts [--prepare] --date=YYYY-MM-DD --recording=<file> [--from=10000] [--reference=<baseline folder>]',
  )
  process.exit(0)
}
if (!values.date || !values.recording)
  throw new Error('Pass --date=YYYY-MM-DD and --recording=<page-inclusive recording>')
const recording = resolve(values.recording)
const out = join(CACHE, 'kit-baseline', new Date().toISOString().replaceAll(':', '-'))
mkdirSync(out, { recursive: true })
function excluded(error: unknown) {
  const reason = error instanceof Error ? error.stack : String(error)
  writeFileSync(join(out, 'excluded.txt'), `${reason}\n`)
  console.error(reason)
  process.exit(1)
}
process.on('uncaughtException', excluded)
process.on('unhandledRejection', excluded)
const commands: unknown[] = []
function command(program: string, args: string[], file: string, env: Record<string, string> = {}) {
  commands.push({ program, args, env, started: new Date().toISOString() })
  writeFileSync(join(out, 'commands.json'), JSON.stringify(commands, null, 2))
  const result = spawnSync(program, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, ...env },
  })
  writeFileSync(join(out, file), result.stdout + result.stderr)
  if (result.status !== 0) throw new Error(`${program} failed; see ${join(out, file)}`)
  return result.stdout
}
function json(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
function images(file: string) {
  return JSON.parse(
    command(
      'docker',
      [
        'image',
        'inspect',
        'snowtime-native:bench',
        'snowtime-kit-render:bench',
        'snowtime-caddy:bench',
        'snowtime-sampler:bench',
        'grafana/k6:2.3.0',
        'alpine',
      ],
      file,
    ),
  ).map((image: { Id: string }) => image.Id)
}
checkOtherSessions()
const release = reserveStack()
let paths: Awaited<ReturnType<typeof dataset>>
try {
  if (values.prepare) {
    command('bun', ['install', '--frozen-lockfile'], 'install.log')
    command('bun', ['run', 'build'], 'app-build.log')
    command('bun', ['native/crates/render/bundle/build.ts'], 'bundle-build.log')
    command('bun', ['native/crates/render/bundle/capture.ts'], 'capture.log')
    paths = await dataset('M', values.date)
    if (!existsSync(recording)) {
      const users = json(paths.users) as BenchUser[]
      const user = users.find(
        (u) => u.role === 'member' && u.projectIds.length > 0 && u.slug !== 'lumen',
      )
      if (!user) throw new Error('No recording user')
      const app = await startApp({
        database: paths.database,
        build: join(ROOT, '.output'),
        env: { BETTER_AUTH_SECRET: LOCAL_SECRET },
      })
      try {
        const captured = await record({ origin: app.url, user, secret: LOCAL_SECRET })
        const full = join(out, 'full-recording.json')
        writeFileSync(full, JSON.stringify(captured))
        mkdirSync(resolve(recording, '..'), { recursive: true })
        command('bun', ['native/bench/api-recording.ts', full, recording], 'slice.log')
      } finally {
        await app.stop()
      }
    }
    for (const [file, image, extra] of [
      ['native/Dockerfile', 'snowtime-native:bench', ['--build-arg', 'CARGO_FEATURES=bench']],
      ['native/crates/render/bundle/bench/Dockerfile', 'snowtime-kit-render:bench', []],
    ] as const)
      command(
        'docker',
        ['build', '-f', file, ...extra, '-t', image, '.'],
        `${image.split(':')[0]}.build.log`,
      )
    for (const target of ['caddy', 'sampler'])
      command(
        'docker',
        ['build', '--target', target, '-t', `snowtime-${target}:bench`, '.'],
        `${target}.build.log`,
      )
    command('docker', ['pull', 'grafana/k6:2.3.0'], 'k6-pull.log')
    command('docker', ['pull', 'alpine'], 'alpine-pull.log')
    writeFileSync(
      join(CACHE, 'kit-baseline/prepared.json'),
      JSON.stringify(
        {
          paths,
          date: values.date,
          recording,
          images: images('images.json'),
          commit: command('git', ['rev-parse', 'HEAD'], 'commit.txt').trim(),
        },
        null,
        2,
      ),
    )
    console.log(`Preparation only. Logs: ${out}`)
    process.exitCode = 0
  } else {
    const prepared = json(join(CACHE, 'kit-baseline/prepared.json'))
    if (prepared.date !== values.date || prepared.recording !== recording)
      throw new Error('Run --prepare with these inputs first')
    paths = prepared.paths
    if (prepared.commit !== command('git', ['rev-parse', 'HEAD'], 'prepared-commit.txt').trim())
      throw new Error('Code changed since --prepare; rebuild before measuring')
    const cpuCount = Number(
      command('docker', ['info', '--format', '{{.NCPU}}'], 'docker-cpus.txt').trim(),
    )
    if (cpuCount < 4)
      throw new Error('Give Docker at least four CPUs; CPU 0 is reserved for the app stack')
    command('git', ['rev-parse', 'HEAD'], 'commit.txt')
    command('git', ['status', '--short'], 'checkout-status.txt')
    command('git', ['diff', 'HEAD'], 'checkout.patch')
    command('uname', ['-a'], 'uname.txt')
    command('lscpu', [], 'cpu.txt')
    command('free', ['-b'], 'memory.txt')
    command('docker', ['info'], 'docker-info.txt')
    command('docker', ['version'], 'docker-version.txt')
    if (JSON.stringify(images('images.json')) !== JSON.stringify(prepared.images))
      throw new Error('Images changed since preparation')
    const fixtures = join(ROOT, 'native/crates/render/results')
    const inputPaths = [
      paths.database,
      paths.users,
      recording,
      join(ROOT, 'bun.lock'),
      join(ROOT, 'native/Cargo.lock'),
      ...['render.js', 'render.shared.js', 'manifest.json'].map((p) =>
        join(ROOT, 'native/crates/render/bundle/dist', p),
      ),
      ...['timer', 'week', 'month', 'year', 'answers'].map((p) => join(fixtures, `${p}.json`)),
    ]
    writeFileSync(
      join(out, 'hashes.json'),
      JSON.stringify(
        Object.fromEntries(
          inputPaths.map((p) => [p, createHash('sha256').update(readFileSync(p)).digest('hex')]),
        ),
        null,
        2,
      ),
    )
    mkdirSync(join(out, 'fixtures'))
    for (const page of ['timer', 'week', 'month', 'year', 'answers'])
      cpSync(join(fixtures, `${page}.json`), join(out, 'fixtures', `${page}.json`))
    const render: Record<string, Record<string, number[]>> = {}
    const running = command('docker', ['ps', '--format', '{{.Names}}'], 'running-containers.txt')
      .trim()
      .split('\n')
      .filter((name) => /^snowtime-bench-(app|caddy|sampler|litestream)-1$/.test(name))
    if (running.length) command('docker', ['stop', ...running], 'stop-stack.log')
    for (const page of ['timer', 'week', 'month', 'year']) {
      render[page] = { v8: [], bun: [] }
      for (let round = 1; round <= 3; round++) {
        for (const engine of round === 2 ? ['bun', 'v8'] : ['v8', 'bun']) {
          const args =
            engine === 'v8'
              ? [
                  '-e',
                  'RENDER_HEAP_MB=128',
                  '-e',
                  'RENDER_SEMI_MB=32',
                  'snowtime-kit-render:bench',
                  'render-bench',
                  `/results/${page}.json`,
                  '/results/answers.json',
                  '500',
                  '1',
                  '1',
                  `/raw/${page}-${engine}-${round}.html`,
                ]
              : [
                  '-e',
                  'RENDER_PROPS=plain',
                  'snowtime-kit-render:bench',
                  'bun',
                  '/repo/native/crates/render/bundle/bun-bench.ts',
                  `/results/${page}.json`,
                  '/results/answers.json',
                  '500',
                  `/raw/${page}-${engine}-${round}.html`,
                ]
          const text = command(
            'docker',
            [
              'run',
              '--rm',
              '--cpus=1',
              '--cpuset-cpus=0',
              '--memory=2g',
              '--memory-swap=2g',
              '-v',
              `${ROOT}:/repo:ro`,
              '-v',
              `${fixtures}:/results:ro`,
              '-v',
              `${out}:/raw`,
              ...args,
            ],
            `${page}-${engine}-${round}.json`,
          )
          const cpu = JSON.parse(text).cpu_ms
          if (!Number.isFinite(cpu) || cpu <= 0) throw new Error('Missing render CPU measurement')
          render[page][engine].push(cpu)
        }
      }
    }
    writeFileSync(join(out, 'render-summary.json'), JSON.stringify(render, null, 2))
  }
} finally {
  release()
}
if (values.prepare) process.exit(0)

const label = `kit-${Date.now()}`
const common = [
  'perf/stress/stress.ts',
  '--app=native',
  '--direct',
  '--dataset=M',
  `--dataset-date=${values.date}`,
  `--recording=${recording}`,
  '--encoding=gzip',
  '--no-build',
  '--memory=2g',
  '--read-connections=0',
  '--app-cpuset=0',
  '--caddy-cpuset=0',
  '--sampler-cpuset=0',
  `--k6-cpuset=1-${Number(readFileSync(join(out, 'docker-cpus.txt'), 'utf8')) - 1}`,
  '--queue-max-waiting=4096',
  '--queue-timeout-ms=1000',
]
function stress(mode: string, args: string[]) {
  const runLabel = `${label}-${mode}`
  command('bun', [...common, ...args, `--label=${runLabel}`], `${mode}.log`, {
    BENCH_APP_CPUS: '1',
    BENCH_RENDERERS: '1',
  })
  const folder = readdirSync(join(CACHE, 'stress/runs')).find((p) => p.endsWith(runLabel))
  if (!folder) throw new Error(`Missing ${mode} output`)
  const dest = join(out, mode)
  cpSync(join(CACHE, 'stress/runs', folder), dest, { recursive: true })
  return dest
}
const ramp = stress('ramp', [
  '--run=ramp',
  `--from=${values.from}`,
  '--step-seconds=30',
  '--hold-seconds=120',
])
const capacity = json(join(ramp, 'capacity.json'))
if (!capacity.users || capacity.generatorLimited)
  throw new Error('Excluded ramp: no valid capacity; preserve raw output and repeat')
const holds: { peakMiB: number; holdPeakMiB: number }[] = []
for (let round = 1; round <= 2; round++) {
  const folder = stress(`rss-${round}`, [
    '--run=fixed',
    `--users=${capacity.users}`,
    '--seconds=120',
  ])
  const validity = json(join(folder, 'fixed.validity.json'))
  if (validity.generatorLimited || validity.aborted || validity.missed.length)
    throw new Error(`Excluded RSS run ${round}: ${JSON.stringify(validity)}`)
  const inspection = json(join(folder, 'app.inspect.json'))[0]
  if (
    inspection.HostConfig.NanoCpus !== 1e9 ||
    inspection.HostConfig.Memory !== 2 ** 31 ||
    inspection.State.OOMKilled ||
    inspection.RestartCount
  )
    throw new Error('Excluded RSS run: wrong limits, restart, or OOM')
  const status = readFileSync(join(folder, 'app.proc-status.txt'), 'utf8')
  const high = status.match(/^VmHWM:\s+(\d+) kB/m)
  if (!high) throw new Error('Missing process lifetime RSS high-water mark')
  const samples = json(join(folder, 'fixed.samples.json'))
  if (
    !samples.length ||
    samples.some((s: { containers: { app?: unknown } }) => !s.containers.app) ||
    !samples.some((s: { containers: { k6?: unknown } }) => s.containers.k6)
  )
    throw new Error('Excluded RSS run: missing app or generator samples')
  if (
    samples.some((s: { containers: Record<string, { swap?: number; oomKills: number }> }) =>
      Object.values(s.containers).some((c) => (c.swap ?? 0) > 0 || c.oomKills > 0),
    )
  )
    throw new Error('Excluded RSS run: swap or OOM')
  holds.push({
    peakMiB: Number(high[1]) / 1024,
    holdPeakMiB:
      Math.max(
        ...samples.map((s: { containers: { app: { rss: number } } }) => s.containers.app.rss),
      ) /
      2 ** 20,
  })
}
const result = { render: json(join(out, 'render-summary.json')), holds, capacity }
writeFileSync(join(out, 'summary.json'), JSON.stringify(result, null, 2))
if (values.reference) {
  const reference = json(join(resolve(values.reference), 'summary.json'))
  const oldHashes = json(join(resolve(values.reference), 'hashes.json'))
  const currentHashes = json(join(out, 'hashes.json'))
  for (const suffix of [
    '.db',
    '.users.json',
    ...['timer', 'week', 'month', 'year', 'answers'].map((page) => `/results/${page}.json`),
  ]) {
    const oldInput = Object.entries(oldHashes).find(([path]) => path.endsWith(suffix))?.[1]
    const currentInput = Object.entries(currentHashes).find(([path]) => path.endsWith(suffix))?.[1]
    if (!oldInput || currentInput !== oldInput)
      throw new Error(`Excluded comparison: changed input ${suffix}`)
  }
  const alerts: string[] = []
  function check(name: string, old: number[], current: number[]) {
    const sorted = [...current].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const ceiling = Math.max(...old) + Math.max(...old) - Math.min(...old)
    if (median > ceiling)
      alerts.push(`${name}: ${median} exceeds baseline max plus spread (${ceiling})`)
  }
  for (const page of Object.keys(result.render))
    for (const engine of ['v8', 'bun'])
      check(`${page}/${engine} CPU`, reference.render[page][engine], result.render[page][engine])
  for (const metric of ['peakMiB', 'holdPeakMiB'] as const)
    check(
      metric,
      reference.holds.map((h: (typeof holds)[number]) => h[metric]),
      holds.map((h) => h[metric]),
    )
  if (capacity.users < reference.capacity.users)
    alerts.push(
      'Capacity decreased: repeat the lower and former held offers before declaring a regression',
    )
  writeFileSync(join(out, 'comparison.json'), JSON.stringify({ alerts }, null, 2))
}
console.log(
  `Baseline complete: ${out}. Review generator memory/VUs and host sizing logs before accepting summary.json.`,
)
