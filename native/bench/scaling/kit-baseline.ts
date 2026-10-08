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
  },
})
if (values.help) {
  console.log('kit-baseline.ts [--prepare] --date=YYYY-MM-DD --recording=<file> [--from=10000]')
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
    command(
      'bun',
      [
        '-e',
        "import { compose, useApp } from './perf/stress/stack'; useApp('native'); compose(['up', '-d', '--wait', '--no-deps', 'caddy'])",
      ],
      'certificate-start.log',
    )
    try {
      command(
        'curl',
        [
          '--silent',
          '--show-error',
          '--insecure',
          '--resolve',
          'snowtime-bench.test:8443:127.0.0.1',
          '--retry',
          '10',
          '--retry-connrefused',
          '--retry-delay',
          '1',
          '--max-time',
          '10',
          'https://snowtime-bench.test:8443',
        ],
        'certificate-handshake.log',
      )
    } finally {
      command(
        'bun',
        [
          '-e',
          "import { compose, useApp } from './perf/stress/stack'; useApp('native'); compose(['stop', 'caddy'])",
        ],
        'certificate-stop.log',
      )
    }
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
writeFileSync(join(out, 'summary.json'), JSON.stringify({ holds, capacity }, null, 2))
console.log(
  `Full baseline complete: ${out}. Review generator memory/VUs and host sizing logs before accepting summary.json.`,
)
