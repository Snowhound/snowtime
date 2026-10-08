import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { signInHeaders } from '../../perf/lib/app'
import { CACHE, ROOT, seededDatabase } from '../../perf/lib/database'
import { checkNativeBenchmarkHealth } from '../../perf/stress/health'
import { checkOtherSessions, reserveStack } from '../../perf/stress/lock'
import { droppedActions } from '../../perf/stress/metrics'
import { LOCAL_SECRET } from '../../perf/stress/stack'
import { compareMetric } from './gate/metrics'
import { processUsage, startNative } from './native'
import { nativeHotTimings } from './timings'

const { values } = parseArgs({
  options: {
    freeze: { type: 'boolean', default: false },
    'build-current': { type: 'boolean', default: false },
    inside: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
    out: { type: 'string' },
    renders: { type: 'string', default: '25' },
    repeats: { type: 'string', default: '1000' },
    rate: { type: 'string', default: '30' },
  },
})
if (values.help) {
  console.log('perf-gate.ts --freeze | --build-current | [--renders=25 --repeats=1000 --rate=30]')
  process.exit(0)
}
for (const value of [values.renders, values.repeats, values.rate])
  if (!Number.isInteger(Number(value)) || Number(value) < 1)
    throw new Error('Counts and rate must be positive integers')
const gate = join(CACHE, 'native-gate')
const out = values.out ?? join(gate, 'runs', new Date().toISOString().replaceAll(':', '-'))
mkdirSync(out, { recursive: true })
const commands: unknown[] = []
function command(program: string, args: string[], log: string, env: Record<string, string> = {}) {
  commands.push({ program, args, env, started: new Date().toISOString() })
  writeFileSync(join(out, 'commands.json'), JSON.stringify(commands, null, 2))
  const result = spawnSync(program, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, ...env },
  })
  writeFileSync(join(out, log), result.stdout + result.stderr)
  if (result.status !== 0) throw new Error(`${program} exited ${result.status}; see ${log}`)
  return result.stdout
}
function json(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
function hash(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
function seal(directory: string, files: string[]) {
  return Object.fromEntries(
    files.map((file) => [
      file,
      { sha256: hash(join(directory, file)), bytes: statSync(join(directory, file)).size },
    ]),
  )
}
function snapshot(name: string) {
  const dest = join(gate, name)
  if (name === 'baseline' && existsSync(dest))
    throw new Error('Baseline already exists; keep it unchanged')
  mkdirSync(dest, { recursive: true })
  for (const [image, source, file] of [
    ['snowtime-native:bench', '/app/snowtime', 'server'],
    ['snowtime-kit-render:bench', '/usr/local/bin/render-bench', 'render-bench'],
  ]) {
    const container = command('docker', ['create', image], `${name}-${file}-create.txt`).trim()
    try {
      command(
        'docker',
        ['cp', `${container}:${source}`, join(dest, file)],
        `${name}-${file}-copy.txt`,
      )
    } finally {
      command('docker', ['rm', container], `${name}-${file}-remove.txt`)
    }
  }
  cpSync(
    join(ROOT, 'native/crates/render/bundle/dist/render.shared.js'),
    join(dest, 'render.shared.js'),
  )
  writeFileSync(
    join(dest, 'artifact.json'),
    JSON.stringify(
      {
        commit: command('git', ['rev-parse', 'HEAD'], `${name}-commit.txt`).trim(),
        diff: command('git', ['diff', 'HEAD'], `${name}-diff.patch`),
        images: JSON.parse(
          command(
            'docker',
            ['image', 'inspect', 'snowtime-native:bench', 'snowtime-kit-render:bench'],
            `${name}-images.json`,
          ),
        ),
        files: seal(dest, ['server', 'render-bench', 'render.shared.js']),
      },
      null,
      2,
    ),
  )
}
async function replay(server: { url: string; pid: number }, round: string) {
  const inputs = join(gate, 'inputs')
  const summaryPath = join(out, `${round}-load-summary.json`)
  const ownCpu = process.cpuUsage()
  const before = processUsage(server.pid)
  const began = performance.now()
  const generator = Bun.spawn(
    [
      'k6',
      'run',
      '--quiet',
      '--summary-export',
      summaryPath,
      join(ROOT, 'perf/stress/scenario.js'),
    ],
    {
      env: {
        ...process.env,
        ORIGIN: server.url,
        SECRET: LOCAL_SECRET,
        RECORDING: join(inputs, 'api-slice.json'),
        USERS: join(inputs, 'M.users.json'),
        PLAN: JSON.stringify([
          {
            name: 'gate',
            action: 'gate-slice',
            users: 0,
            perHour: Number(values.rate) * 3600,
            seconds: 10,
            start: 1,
          },
        ]),
        PREALLOCATED_VUS: '50',
        MAX_VUS: '50',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const stdout = new Response(generator.stdout).text()
  const stderr = new Response(generator.stderr).text()
  let done = false
  const exited = generator.exited.then((code) => {
    done = true
    return code
  })
  const samples: unknown[] = []
  let previous = processUsage(generator.pid)
  let sampled = performance.now()
  let maximumCpu = 0
  let peakSwap = 0
  let maximumMemory = 0
  for (;;) {
    if (done) break
    await Bun.sleep(250)
    if (done) break
    const now = performance.now()
    const usage = processUsage(generator.pid)
    const serverUsage = processUsage(server.pid)
    const clientUsage = processUsage(process.pid)
    if (now - began >= 1250)
      maximumCpu = Math.max(maximumCpu, (usage.cpuMs - previous.cpuMs) / (now - sampled))
    peakSwap = Math.max(peakSwap, usage.swapKiB, serverUsage.swapKiB, clientUsage.swapKiB)
    maximumMemory = Math.max(maximumMemory, usage.rssMiB + serverUsage.rssMiB + clientUsage.rssMiB)
    samples.push({
      t: now,
      startup: now - began < 1250,
      generator: usage,
      server: serverUsage,
      client: clientUsage,
    })
    previous = usage
    sampled = now
  }
  const code = await exited
  const elapsed = (performance.now() - began) / 1000
  const after = processUsage(server.pid)
  writeFileSync(join(out, `${round}-generator.log`), (await stdout) + (await stderr))
  writeFileSync(join(out, `${round}-load-samples.json`), JSON.stringify(samples))
  const summary = json(summaryPath)
  const requests = summary.metrics.http_reqs?.values?.count ?? 0
  const errors = Object.entries(summary.metrics).some(
    ([name, metric]) =>
      name.startsWith('bench_errors') &&
      (metric as { values: { count?: number } }).values.count! > 0,
  )
  const clientCpu = process.cpuUsage(ownCpu)
  const actionP95 = summary.metrics['bench_action_duration{step:gate}']?.values?.['p(95)']
  const neededVUs = (actionP95 / 1000) * Number(values.rate)
  writeFileSync(
    join(out, `${round}-generator-validity.json`),
    JSON.stringify(
      {
        maximumCpu,
        maximumMemoryMiB: maximumMemory,
        estimatedVUsAtP95: neededVUs,
        allocatedVUs: 50,
        elapsed,
        peakSwapKiB: peakSwap,
      },
      null,
      2,
    ),
  )
  if (
    code !== 0 ||
    !requests ||
    droppedActions(summary.metrics, 'gate') ||
    errors ||
    maximumCpu > 0.7 ||
    maximumMemory > 1536 ||
    !Number.isFinite(neededVUs) ||
    neededVUs > 35 ||
    (clientCpu.user + clientCpu.system) / 1e6 / elapsed > 0.2 ||
    peakSwap ||
    after.swapKiB ||
    elapsed > 13
  )
    throw new Error(
      `${round}: invalid generator/replay (exit=${code}, requests=${requests}, max generator CPU=${maximumCpu}, elapsed=${elapsed})`,
    )
  return { cpu_ms: (after.cpuMs - before.cpuMs) / requests, peak_rss_mib: after.peakMiB }
}
async function inside() {
  const inputs = join(gate, 'inputs')
  const all: Record<string, Record<string, number>> = {}
  for (const [index, name] of ['baseline', 'current', 'baseline', 'current'].entries()) {
    const round = `${index + 1}-${name}`
    const artifact = join(gate, name)
    const manifest = json(join(artifact, 'artifact.json'))
    for (const file of Object.keys(manifest.files))
      if (hash(join(artifact, file)) !== manifest.files[file].sha256)
        throw new Error(`Changed retained ${name} artifact ${file}`)
    const metrics: Record<string, number> = {}
    for (const page of ['timer', 'week', 'month', 'year']) {
      const result = JSON.parse(
        command(
          join(artifact, 'render-bench'),
          [
            join(inputs, `${page}.json`),
            join(inputs, 'answers.json'),
            values.renders,
            '1',
            '1',
            join(out, `${round}-${page}.html`),
          ],
          `${round}-${page}.json`,
          {
            RENDER_HEAP_MB: '128',
            RENDER_SEMI_MB: '32',
            RENDER_BENCH_SKIP_FINAL_IDLE: '1',
          },
        ),
      )
      for (const metric of ['cpu_ms', 'p50_ms', 'p95_ms', 'peak_rss_mb'])
        metrics[`render/${page}/${metric}`] = result[metric]
    }
    const env = {
      RATE_LIMIT: 'off',
      EDGE_ACCESS_LOG: 'off',
      DB_READ_CONNECTIONS: '0',
      RENDERERS: '1',
    }
    const api = await startNative(join(artifact, 'server'), join(inputs, 'api.db'), env)
    try {
      checkNativeBenchmarkHealth(await fetch(`${api.url}/readyz`).then((r) => r.json()))
      const result = await nativeHotTimings(
        api,
        await signInHeaders(api, 'admin'),
        Number(values.repeats),
      )
      writeFileSync(join(out, `${round}-api.json`), JSON.stringify(result, null, 2))
      for (const [call, times] of Object.entries(result))
        for (const [metric, value] of Object.entries(times))
          metrics[`api/${call}/${metric}`] = value
    } finally {
      await api.stop()
    }
    const load = await startNative(join(artifact, 'server'), join(inputs, 'M.db'), {
      ...env,
      BETTER_AUTH_SECRET: LOCAL_SECRET,
    })
    try {
      checkNativeBenchmarkHealth(await fetch(`${load.url}/readyz`).then((r) => r.json()))
      const result = await replay(load, round)
      for (const [metric, value] of Object.entries(result)) metrics[`load/${metric}`] = value
    } finally {
      await load.stop()
    }
    metrics['static/binary_bytes'] = statSync(join(artifact, 'server')).size
    metrics['static/render_bundle_bytes'] = statSync(join(artifact, 'render.shared.js')).size
    all[round] = metrics
    writeFileSync(join(out, 'rounds.json'), JSON.stringify(all, null, 2))
  }
  const comparison = Object.fromEntries(
    Object.keys(all['1-baseline']).map((metric) => [
      metric,
      compareMetric(
        [all['1-baseline'][metric], all['3-baseline'][metric]],
        [all['2-current'][metric], all['4-current'][metric]],
        metric.endsWith('/cpu_ms'),
      ),
    ]),
  )
  writeFileSync(join(out, 'comparison.json'), JSON.stringify(comparison, null, 2))
  const rows = [
    '| Metric | Baseline | Current | Delta | Noise band | Gate |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    ...Object.entries(comparison).map(
      ([metric, r]) =>
        `| ${metric} | ${r.baseline.toFixed(3)} | ${r.current.toFixed(3)} | ${r.deltaPercent === null ? r.delta.toFixed(3) : `${r.deltaPercent.toFixed(1)}%`} | ${r.band.toFixed(3)} | ${r.flagged ? 'REGRESSION' : 'pass'} |`,
    ),
  ]
  writeFileSync(join(out, 'table.md'), rows.join('\n') + '\n')
  console.log(rows.join('\n'))
  if (Object.values(comparison).some((r) => r.flagged)) process.exitCode = 1
}
async function main() {
  if (values.inside) {
    await inside()
    return
  }
  checkOtherSessions()
  const release = reserveStack()
  try {
    if (values.freeze) {
      const prepared = json(join(CACHE, 'kit-baseline/prepared.json'))
      if (prepared.commit !== command('git', ['rev-parse', 'HEAD'], 'freeze-commit.txt').trim())
        throw new Error('Run kit-baseline.ts --prepare at this commit before freezing')
      snapshot('baseline')
      const inputs = join(gate, 'inputs')
      mkdirSync(inputs, { recursive: true })
      for (const page of ['timer', 'week', 'month', 'year', 'answers'])
        cpSync(
          join(ROOT, `native/crates/render/results/${page}.json`),
          join(inputs, `${page}.json`),
        )
      cpSync(await seededDatabase(), join(inputs, 'api.db'))
      cpSync(prepared.paths.database, join(inputs, 'M.db'))
      cpSync(prepared.paths.users, join(inputs, 'M.users.json'))
      command(
        'bun',
        [
          'native/bench/api-recording.ts',
          prepared.recording,
          join(inputs, 'api-slice.json'),
          '--api-only',
          'getAppSession',
          'getRunningTimer',
          'listEntries',
          'getReport',
        ],
        'api-slice.log',
      )
      const slice = json(join(inputs, 'api-slice.json'))
      const requests = [...slice.actions.return, ...slice.actions['reports-week']].filter(
        (request: { path: string }) => request.path.startsWith('/api/v1/'),
      )
      slice.actions = {
        'gate-slice': [
          ...new Map(
            requests.map((request: unknown) => [JSON.stringify(request), request]),
          ).values(),
        ],
      }
      if (!slice.actions['gate-slice'].length)
        throw new Error('Recording has no return/week API slice')
      for (const endpoint of ['/session', '/timer', '/entries', '/report'])
        if (
          !slice.actions['gate-slice'].some((request: { path: string }) =>
            request.path.split('?')[0].endsWith(endpoint),
          )
        )
          throw new Error(`Recording is missing hot call ${endpoint}`)
      writeFileSync(join(inputs, 'api-slice.json'), JSON.stringify(slice, null, 2))
      writeFileSync(
        join(inputs, 'hashes.json'),
        JSON.stringify(
          seal(inputs, [
            'api.db',
            'M.db',
            'M.users.json',
            'api-slice.json',
            'timer.json',
            'week.json',
            'month.json',
            'year.json',
            'answers.json',
          ]),
          null,
          2,
        ),
      )
      command(
        'docker',
        ['build', '-f', 'native/bench/gate/Dockerfile', '-t', 'snowtime-perf-gate:runtime', '.'],
        'runtime-build.log',
      )
      snapshot('current')
    } else if (values['build-current']) {
      command('bun', ['run', 'build'], 'app-build.log')
      command('bun', ['native/crates/render/bundle/build.ts'], 'bundle-build.log')
      command(
        'docker',
        [
          'build',
          '-f',
          'native/Dockerfile',
          '--build-arg',
          'CARGO_FEATURES=bench',
          '-t',
          'snowtime-native:bench',
          '.',
        ],
        'server-build.log',
      )
      command(
        'docker',
        [
          'build',
          '-f',
          'native/crates/render/bundle/bench/Dockerfile',
          '-t',
          'snowtime-kit-render:bench',
          '.',
        ],
        'render-build.log',
      )
      snapshot('current')
    } else {
      const current = json(join(gate, 'current/artifact.json'))
      if (
        current.commit !== command('git', ['rev-parse', 'HEAD'], 'current-commit.txt').trim() ||
        current.diff !== command('git', ['diff', 'HEAD'], 'current-diff.patch')
      )
        throw new Error(
          'Current checkout changed since artifact capture; run --build-current first',
        )
      cpSync(join(gate, 'baseline/artifact.json'), join(out, 'baseline-artifact.json'))
      cpSync(join(gate, 'current/artifact.json'), join(out, 'current-artifact.json'))
      cpSync(join(gate, 'inputs/hashes.json'), join(out, 'input-hashes.json'))
      for (const [file, h] of Object.entries(json(join(gate, 'inputs/hashes.json'))))
        if (hash(join(gate, 'inputs', file)) !== (h as { sha256: string }).sha256)
          throw new Error(`Changed gate input ${file}`)
      command('uname', ['-a'], 'machine.txt')
      command('lscpu', [], 'cpu.txt')
      command('docker', ['image', 'inspect', 'snowtime-perf-gate:runtime'], 'runtime-image.json')
      const running = command('docker', ['ps', '--format', '{{.Names}}'], 'running-containers.txt')
        .trim()
        .split('\n')
        .filter((name) => /^snowtime-bench-(app|caddy|sampler|litestream)-1$/.test(name))
      if (running.length) command('docker', ['stop', ...running], 'stop-bench-stack.log')
      const started = Date.now()
      console.log('[gate] Starting retained baseline/current A/B/A/B; no builds during this run')
      commands.push({
        program: 'docker',
        limits: { cpus: 1, cpuset: '0', memory: '2g', swap: 'disabled' },
        renders: values.renders,
        repeats: values.repeats,
        rate: values.rate,
        started: new Date().toISOString(),
      })
      writeFileSync(join(out, 'commands.json'), JSON.stringify(commands, null, 2))
      const result = spawnSync(
        'docker',
        [
          'run',
          '--rm',
          '--cpus=1',
          '--cpuset-cpus=0',
          '--memory=2g',
          '--memory-swap=2g',
          '-v',
          `${ROOT}:/repo`,
          'snowtime-perf-gate:runtime',
          `--out=/repo/${relative(ROOT, out)}`,
          `--renders=${values.renders}`,
          `--repeats=${values.repeats}`,
          `--rate=${values.rate}`,
        ],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      )
      writeFileSync(join(out, 'gate.log'), result.stdout + result.stderr)
      writeFileSync(join(out, 'elapsed-seconds.txt'), `${(Date.now() - started) / 1000}\n`)
      if (result.status !== 0 && result.status !== 1 && !existsSync(join(out, 'excluded.txt')))
        writeFileSync(
          join(out, 'excluded.txt'),
          `Gate container exited ${result.status}; see gate.log\n`,
        )
      console.log(result.stdout)
      if (result.stderr) console.error(result.stderr)
      process.exitCode = result.status ?? 1
    }
  } finally {
    release()
  }
  console.log(`Evidence: ${out}`)
}
try {
  await main()
} catch (error) {
  writeFileSync(
    join(out, 'excluded.txt'),
    `${error instanceof Error ? error.stack : String(error)}\n`,
  )
  console.error(error)
  console.error(`Excluded evidence: ${out}`)
  process.exitCode = 2
}
