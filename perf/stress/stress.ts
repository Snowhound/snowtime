// The load benchmark (task 078, perf/README.md "Load benchmark"): replays the usage model at
// fixed arrival rates against the release image on 1 CPU and 2 GB, and prints per load step
// what the server sent and what it cost.
//
//   bun run perf:stress --dataset=M --run=ramp
//   bun run perf:stress --dataset=S --run=fixed --users=200 --seconds=300
//   bun run perf:stress --dataset=M --run=kinds
//   bun run perf:stress --dataset=M --run=overload --users=<knee>
//   bun run perf:stress --remote --dataset=M --run=ramp
//   bun run perf:stress --app=native --recording=<file> --dataset=M --run=kinds
//
// Locally it builds the images, loads the dataset into the bench volume, and starts the stack
// (stack.ts). With --remote it sends load to a server that runs compose.bench.yml, which
// someone else started with the same dataset; it only sends requests and reads the sampler.

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { table } from '../checks/baseline'
import { CACHE, ROOT } from '../lib/database'
import { type BenchUser, DATASETS, type DatasetName, dataset } from './dataset'
import { checkOtherSessions, reserveStack } from './lock'
import { droppedActions } from './metrics'
import { type Recording, record } from './record'
import {
  type App,
  K6_IMAGE,
  LOCAL_HOST,
  LOCAL_PORT,
  LOCAL_SAMPLER_PASSWORD,
  LOCAL_SECRET,
  NETWORK,
  buildImages,
  compose,
  directTls,
  directAddress,
  loadDataset,
  startStack,
  useApp,
} from './stack'

// Server-side p95 targets in milliseconds (task 078, "Runs"), by request kind. Signing in
// has a page's target, because its password hash is slow on purpose.
function targetMs(kind: string): number {
  if (kind.startsWith('reports-year') || kind.startsWith('export')) return 3000
  if (kind.endsWith(' page') || kind === 'sign-in auth') return 1000
  return 300
}
const MAX_ERROR_SHARE = 0.001
const WINDOW_S = 30
// The ramp's steps in active users; it stops at the first one that misses a target.
const RAMP = [
  50, 100, 200, 300, 400, 500, 650, 800, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000, 6500, 8000,
  10000, 12500, 15000, 20000, 25000, 30000, 40000, 50000, 65000, 80000, 100000, 125000, 150000,
  200000,
]
// On a server, the ramp ends when memory or disk passes these shares.
const MAX_MEMORY_SHARE = 0.85
const MAX_DISK_SHARE = 0.8

const { values } = parseArgs({
  options: {
    plan: { type: 'string' },
    'past-capacity': { type: 'boolean', default: false },
    runtime: { type: 'string', default: 'multi_thread' },
    'queue-max-waiting': { type: 'string', default: '4096' },
    'queue-timeout-ms': { type: 'string', default: '1000' },
    dataset: { type: 'string', default: 'S' },
    'dataset-date': { type: 'string' },
    run: { type: 'string', default: 'fixed' },
    users: { type: 'string' },
    seconds: { type: 'string' },
    'step-seconds': { type: 'string', default: '120' },
    'hold-seconds': { type: 'string', default: '600' },
    from: { type: 'string' },
    remote: { type: 'boolean', default: false },
    build: { type: 'boolean', default: true },
    load: { type: 'boolean', default: true },
    memory: { type: 'string' },
    'app-cpuset': { type: 'string', default: '1' },
    'k6-cpuset': { type: 'string', default: '2-9' },
    'sampler-cpuset': { type: 'string', default: '1' },
    'preallocated-vus': { type: 'string' },
    'max-vus': { type: 'string' },
    'warmup-seconds': { type: 'string', default: '30' },
    'sampler-url': { type: 'string' },
    'litestream-image': { type: 'string' },
    'litestream-memory': { type: 'string', default: '128m' },
    'replica-dir': { type: 'string' },
    'read-connections': { type: 'string', default: '0' },
    'caddy-memory': { type: 'string' },
    smol: { type: 'boolean', default: false },
    'max-requests': { type: 'string' },
    'try-duration': { type: 'string' },
    label: { type: 'string' },
    app: { type: 'string', default: 'ts' },
    recording: { type: 'string' },
    'caddy-cpuset': { type: 'string' },
    'caddy-config': { type: 'string' },
    direct: { type: 'boolean', default: false },
    encoding: { type: 'string' },
    'connection-reuse': { type: 'boolean', default: true },
  },
  allowNegative: true,
})

const app = values.app as App
if (app !== 'ts' && app !== 'native') throw new Error('[stress] --app is ts or native')
if (app === 'native' && !values.recording) {
  throw new Error('[stress] The native backend serves no pages to record; pass --recording')
}
if (values.direct && app !== 'native') throw new Error('[stress] --direct requires --app=native')
useApp(app)

const name = values.dataset as DatasetName
if (!DATASETS.includes(name)) throw new Error(`[stress] --dataset is one of ${DATASETS.join(', ')}`)

interface Target {
  origin: string
  // The address k6 and Chrome send the origin's requests to, as ip or ip:port.
  address?: string
  chromeAddress?: string
  secret: string
  samplerPassword: string
  // A local stack's self-signed certificate.
  insecure: boolean
  remote: boolean
}

function required(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`[stress] --remote needs ${key} in the environment`)
  return value
}

const target: Target = values.remote
  ? {
      origin: `https://${required('BENCH_HOST')}`,
      address: required('BENCH_ORIGIN_IP'),
      chromeAddress: `${required('BENCH_ORIGIN_IP')}:443`,
      secret: required('BENCH_AUTH_SECRET'),
      samplerPassword: required('BENCH_SAMPLER_PASSWORD'),
      insecure: false,
      remote: true,
    }
  : {
      origin: `https://${LOCAL_HOST}${values.direct ? ':3000' : ''}`,
      chromeAddress: `127.0.0.1:${LOCAL_PORT}`,
      secret: LOCAL_SECRET,
      samplerPassword: LOCAL_SAMPLER_PASSWORD,
      insecure: true,
      remote: false,
    }

// The sampler, through Caddy at the address the origin's name may not reach.
async function sampler<T>(path: string): Promise<T> {
  const { hostname } = new URL(target.origin)
  const port = target.remote ? 443 : LOCAL_PORT
  const address = target.remote ? target.address! : '127.0.0.1'
  const directSampler =
    values['sampler-url'] ?? (!target.remote ? 'http://127.0.0.1:19100' : undefined)
  const curl = Bun.spawn(
    [
      'curl',
      '--silent',
      '--fail',
      '--max-time',
      '20',
      '--retry',
      '3',
      '--retry-connrefused',
      ...(directSampler
        ? [directSampler + path]
        : [
            '--resolve',
            `${hostname}:${port}:${address}`,
            ...(target.insecure ? ['--insecure'] : []),
            '--user',
            `bench:${target.samplerPassword}`,
            `https://${hostname}:${port}${path}`,
          ]),
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [text, code] = await Promise.all([new Response(curl.stdout).text(), curl.exited])
  if (code !== 0) throw new Error(`[stress] sampler ${path}: curl exited ${code}`)
  return JSON.parse(text) as T
}

interface ContainerSample {
  [key: string]: number | string | undefined
  generation: string
  cpuUsec: number
  memory: number
  memoryPeak: number
  rss: number
  swap?: number
  threads: number
  anon: number
  file: number
  oomKills: number
}

interface Sample {
  t: number
  cpu: Record<string, number>
  memTotal: number
  memAvailable: number
  diskUsed: number
  diskTotal: number
  files: Record<string, number>
  containers: Record<string, ContainerSample>
  readUsec: number
  // The app's process.memoryUsage() and how long it took to answer, on a bench deployment.
  heap?: { rss: number; heapTotal: number; heapUsed: number; external: number; answerMs: number }
}

interface LoggedRequest {
  t: number
  kind: string
  step: string
  status: number
  duration: number
  size: number
}

let outputDirectory: string | undefined
let logOffset = 0
const logged: LoggedRequest[] = []

// Reads Caddy's log of the benchmark's requests up to its end.
async function readLog(): Promise<LoggedRequest[]> {
  const fresh: LoggedRequest[] = []
  for (;;) {
    const { offset, more, requests } = await sampler<{
      offset: number
      more: boolean
      requests: LoggedRequest[]
    }>(`/_bench/log?offset=${logOffset}`)
    fresh.push(...requests)
    logOffset = offset
    if (!more) break
  }
  // One by one: a spread of a long read overflows the stack.
  for (const request of fresh) logged.push(request)
  return fresh
}

interface Step {
  name: string
  users: number
  seconds: number
  // One action alone, at this many per hour.
  action?: string
  perHour?: number
  start?: number
  organization?: string
  userId?: string
  excludeOrganization?: string
}

interface StepResult {
  step: Step
  summary: K6Summary
  requests: LoggedRequest[]
  samples: Sample[]
  aborted: boolean
}

interface K6Summary {
  metrics: Record<string, { values: Record<string, number> }>
}

// Runs k6 for the plan. `watch` runs every 10 seconds; when it returns a reason, k6 stops.
async function runK6(
  plan: Step[],
  files: { recording: string; users: string; out: string },
  watch?: () => Promise<string | null>,
): Promise<{ summary: K6Summary; aborted: string | null }> {
  mkdirSync(files.out, { recursive: true })
  const env = {
    RECORDING: `/data/${relative(join(CACHE, 'stress'), files.recording)}`,
    USERS: `/data/${relative(join(CACHE, 'stress'), files.users)}`,
    ORIGIN: target.origin,
    SECRET: target.secret,
    PLAN: JSON.stringify(plan),
    ...((values.plan || values['past-capacity']) && { LANE_BENCH: '1' }),
    ...(values['preallocated-vus'] && { PREALLOCATED_VUS: values['preallocated-vus'] }),
    ...(values['max-vus'] && { MAX_VUS: values['max-vus'] }),
    ...(values.encoding && { ENCODING: values.encoding }),
    ...(!values['connection-reuse'] && { NO_CONNECTION_REUSE: '1' }),
    ...(target.address && { HOST_IP: target.address }),
    ...(target.insecure && { INSECURE: '1' }),
  }
  const args = [
    'run',
    '--rm',
    ...(target.remote ? [] : ['--network', NETWORK, '--cpuset-cpus', values['k6-cpuset']]),
    '-v',
    `${join(ROOT, 'perf/stress')}:/scripts:ro`,
    '-v',
    `${join(CACHE, 'stress')}:/data:ro`,
    '-v',
    `${files.out}:/out`,
    ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
    K6_IMAGE,
    'run',
    '--quiet',
    '--no-usage-report',
    '/scripts/scenario.js',
  ]
  rmSync(join(files.out, 'summary.json'), { force: true })
  const k6 = spawn('docker', args, { stdio: ['ignore', 'inherit', 'inherit'] })
  const exited = new Promise<number>((resolve) => k6.on('exit', (code) => resolve(code ?? 1)))
  let aborted: string | null = null
  if (watch) {
    const timer = setInterval(async () => {
      if (aborted) return
      aborted = await watch().catch(() => null)
      // SIGINT makes k6 stop and still write its summary.
      if (aborted) k6.kill('SIGINT')
    }, 10_000)
    await exited
    clearInterval(timer)
  } else {
    await exited
  }
  const code = await exited
  if (code !== 0 && !aborted)
    throw new Error(`k6 exited ${code}; refusing stale or invalid results`)
  const summary = JSON.parse(readFileSync(join(files.out, 'summary.json'), 'utf8')) as K6Summary
  return { summary, aborted }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

function ms(value: number) {
  return Number.isNaN(value)
    ? '-'
    : value >= 10_000
      ? `${(value / 1000).toFixed(0)} s`
      : value.toFixed(0)
}

// Counter deltas between the first and last sample, per second.
function rates(samples: Sample[]) {
  const first = samples[0]
  const last = samples.at(-1)!
  const seconds = last.t - first.t || 1
  function container(name: string) {
    const observed = samples.filter((s) => s.containers[name])
    const a = observed[0]?.containers[name]
    const b = observed.at(-1)?.containers[name]
    let observedSeconds = 0
    const deltas: Record<string, number> = {}
    let peakCpu = 0
    for (let i = 1; i < observed.length; i++) {
      const previous = observed[i - 1],
        next = observed[i]
      const x = previous.containers[name],
        y = next.containers[name]
      if (x.generation !== y.generation || y.cpuUsec < x.cpuUsec) continue
      const elapsed = next.t - previous.t
      if (elapsed > 2 || elapsed <= 0) continue
      observedSeconds += elapsed
      peakCpu = Math.max(peakCpu, (y.cpuUsec - x.cpuUsec) / elapsed / 1e6)
      for (const key of Object.keys(y)) {
        if (typeof y[key] === 'number' && typeof x[key] === 'number')
          deltas[key] = (deltas[key] ?? 0) + Math.max(0, y[key] - x[key])
      }
    }
    function per(key: string) {
      return (deltas[key] ?? 0) / (observedSeconds || 1)
    }
    const peak = Math.max(...samples.map((s) => s.containers[name]?.memory ?? 0))
    return {
      cpu: per('cpuUsec') / 1e6,
      cpuUsec: deltas.cpuUsec ?? 0,
      observedSeconds,
      peakCpu,
      throttled: per('throttledUsec') / 1e6,
      memory: b?.memory ?? 0,
      peak,
      peakEver: b?.memoryPeak ?? 0,
      anon: b?.anon ?? 0,
      file: b?.file ?? 0,
      rss: Math.max(...samples.map((s) => s.containers[name]?.rss ?? 0)),
      swap: Math.max(...samples.map((s) => s.containers[name]?.swap ?? 0)),
      read: per('readBytes'),
      write: per('writeBytes'),
      cpuPressure: per('cpuSome') / 1e6,
      memoryPressure: per('memorySome') / 1e6,
      ioPressure: per('ioSome') / 1e6,
      oomKills: (b?.oomKills ?? 0) - (a?.oomKills ?? 0),
    }
  }
  const ticks = Object.keys(last.cpu).reduce((t, k) => t + last.cpu[k] - first.cpu[k], 0) || 1
  return {
    seconds,
    app: container('app'),
    caddy: container('caddy'),
    sampler: container('sampler'),
    k6: container('k6'),
    litestream: container('litestream'),
    steal: (last.cpu.steal - first.cpu.steal) / ticks,
    memoryUsed: Math.max(...samples.map((s) => s.memTotal - s.memAvailable)),
    memTotal: last.memTotal,
    diskShare: last.diskUsed / last.diskTotal,
    database: Object.values(last.files).reduce((a, b) => a + b, 0),
    readUsec: samples.reduce((t, s) => t + s.readUsec, 0) / samples.length,
    heap: heapStats(samples.flatMap((s) => (s.heap ? [s.heap] : []))),
  }
}

// The heap at its peak, and the app's slowest answer to the sampler: a stall shows as one
// at the 500 ms timeout.
function heapStats(heaps: NonNullable<Sample['heap']>[]) {
  if (heaps.length === 0) return undefined
  const peak = heaps.reduce((a, b) => (b.heapUsed > a.heapUsed ? b : a))
  return {
    peak,
    slowest: Math.max(...heaps.map((h) => h.answerMs)),
    stalled: heaps.filter((h) => h.answerMs >= 500).length,
  }
}

function requestBounds(requests: LoggedRequest[]) {
  let first = Infinity
  let last = -Infinity
  for (const request of requests) {
    first = Math.min(first, request.t)
    last = Math.max(last, request.t)
  }
  return { first, last }
}

// Where a step misses a target: a kind's p95 over any 30-second window, the error share, or
// a dropped iteration.
function misses(result: StepResult): string[] {
  const found: string[] = []
  const { requests } = result
  if (requests.length === 0) return ['no access-log samples; server-window validation unavailable']
  const start = requestBounds(requests).first
  const windows = new Map<string, number[]>()
  for (const r of requests) {
    const key = `${r.kind}|${Math.floor((r.t - start) / WINDOW_S)}`
    const list = windows.get(key) ?? []
    list.push(r.duration * 1000)
    windows.set(key, list)
  }
  for (const [key, durations] of windows) {
    const [kind] = key.split('|')
    // A window needs a few requests of the kind for its p95 to mean anything.
    if (durations.length < 5) continue
    const p95 = percentile(durations, 95)
    if (p95 > targetMs(kind)) found.push(`${kind} p95 ${p95.toFixed(0)} ms in a 30 s window`)
  }
  const sent = metric(result.summary, `http_reqs{step:${result.step.name}}`, 'count')
  const failed = errorCount(result.summary, result.step.name)
  if (sent > 0 && failed / sent > MAX_ERROR_SHARE) {
    found.push(`${((failed / sent) * 100).toFixed(2)}% errors`)
  }
  const dropped = droppedActions(result.summary.metrics, result.step.name)
  if (dropped > 0) found.push(`${dropped} dropped iterations (invalid run)`)
  return [...new Set(found)]
}

function metric(summary: K6Summary, key: string, stat: string): number {
  return summary.metrics[key]?.values[stat] ?? 0
}

const ERROR_TYPES = ['5xx', '429', '4xx', 'connection', 'timeout']

function errorCount(summary: K6Summary, step: string) {
  return ERROR_TYPES.reduce(
    (t, type) => t + metric(summary, `bench_errors{step:${step},type:${type}}`, 'count'),
    0,
  )
}

function mb(bytes: number) {
  return (bytes / 1e6).toFixed(0)
}

function report(result: StepResult): string {
  const { step, summary, requests } = result
  const lines: string[] = []
  const sent = metric(summary, `http_reqs{step:${step.name}}`, 'count')
  const seconds = Math.max(
    1,
    requests.length
      ? requestBounds(requests).last - requestBounds(requests).first || step.seconds
      : step.seconds,
  )
  const completed = requests.filter((r) => r.status > 0 && r.status < 400).length
  lines.push(
    `\n${step.name}: ${step.users} active users, ${step.seconds} s${result.aborted ? ' (aborted)' : ''}. ` +
      `Offered ${(sent / step.seconds).toFixed(1)} req/s, ` +
      (requests.length
        ? `completed ${(completed / seconds).toFixed(1)} req/s`
        : 'logged completions unavailable'),
  )
  const prefix = `http_reqs{step:${step.name},kind:`
  const kinds = Object.keys(summary.metrics)
    .filter((key) => key.startsWith(prefix) && metric(summary, key, 'count') > 0)
    .map((key) => key.slice(prefix.length, -1))
    .sort()
  const rows = kinds.map((kind) => {
    const server = requests.filter((r) => r.kind === kind).map((r) => r.duration * 1000)
    function client(stat: string) {
      return metric(summary, `http_req_duration{step:${step.name},kind:${kind}}`, stat)
    }
    const count = metric(summary, `http_reqs{step:${step.name},kind:${kind}}`, 'count')
    return [
      kind,
      (count / step.seconds).toFixed(2),
      ms(client('med')),
      ms(client('p(95)')),
      ms(client('p(99)')),
      ms(percentile(server, 50)),
      ms(percentile(server, 95)),
      ms(percentile(server, 99)),
      `${targetMs(kind)}`,
    ]
  })
  lines.push(
    table(['Kind', 'req/s', 'p50', 'p95', 'p99', 'srv p50', 'srv p95', 'srv p99', 'target'], rows),
  )
  const errors = ERROR_TYPES.map(
    (type) =>
      [type, metric(summary, `bench_errors{step:${step.name},type:${type}}`, 'count')] as const,
  )
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `${n} ${type}`)
  lines.push(`Errors: ${errors.join(', ') || 'none'}`)
  if (result.samples.length > 1) {
    const r = rates(result.samples)
    const serverRequests = sent || 1
    lines.push(
      table(
        [
          'Container',
          'CPU',
          'throttled',
          'mem MB',
          'peak',
          'anon',
          'cache',
          'RSS',
          'swap',
          'read MB/s',
          'write',
          'PSI cpu',
          'mem',
          'io',
        ],
        (['app', 'caddy', 'sampler', 'litestream', 'k6'] as const).map((n) => {
          const c = r[n]
          return [
            n,
            `${(c.cpu * 100).toFixed(1)}%`,
            `${(c.throttled * 100).toFixed(1)}%`,
            mb(c.memory),
            mb(c.peak),
            mb(c.anon),
            mb(c.file),
            mb(c.rss),
            mb(c.swap),
            (c.read / 1e6).toFixed(2),
            (c.write / 1e6).toFixed(2),
            `${(c.cpuPressure * 100).toFixed(0)}%`,
            `${(c.memoryPressure * 100).toFixed(0)}%`,
            `${(c.ioPressure * 100).toFixed(0)}%`,
          ]
        }),
      ),
    )
    lines.push(
      `App CPU per request ${(r.app.cpuUsec / serverRequests / 1000).toFixed(1)} ms, Caddy ` +
        `${(r.caddy.cpuUsec / serverRequests / 1000).toFixed(2)} ms; steal ${(r.steal * 100).toFixed(1)}%; ` +
        `host memory ${mb(r.memoryUsed)} of ${mb(r.memTotal)} MB; database ${mb(r.database)} MB; ` +
        `disk ${(r.diskShare * 100).toFixed(0)}%; OOM kills ${r.app.oomKills}`,
    )
    lines.push(
      `k6 CPU observed for ${r.k6.observedSeconds.toFixed(0)} s: mean ${(r.k6.cpu * 100).toFixed(1)}%, peak one-second ${(r.k6.peakCpu * 100).toFixed(1)}%; app peak threads ${Math.max(...result.samples.map((s) => s.containers.app?.threads ?? 0))}`,
    )
    if (r.heap) {
      const { peak, slowest, stalled } = r.heap
      lines.push(
        `JS heap at its peak ${mb(peak.heapUsed)} of ${mb(peak.heapTotal)} MB, external ` +
          `${mb(peak.external)} MB, RSS then ${mb(peak.rss)} MB; slowest heap answer ${slowest} ms, ` +
          `${stalled} at the timeout`,
      )
    }
  }
  const missed = misses(result)
  lines.push(missed.length ? `Missed: ${missed.join('; ')}` : 'Within targets')
  return lines.join('\n')
}

async function samplesBetween(from: number, to: number): Promise<Sample[]> {
  const all = await sampler<Sample[] | null>(`/_bench/samples?since=${from - 1}`)
  return (all ?? []).filter((s) => s.t >= from - 1 && s.t <= to + 1)
}

// Runs one plan and reports each of its steps.
async function runPlan(plan: Step[], files: { recording: string; users: string; out: string }) {
  await readLog()
  const began = Date.now() / 1000
  async function watch(): Promise<string | null> {
    await readLog()
    if (!target.remote) {
      const recent = await samplesBetween(Date.now() / 1000 - 5, Date.now() / 1000)
      const last = recent.at(-1)
      if (last && (last.memTotal - last.memAvailable) / last.memTotal > MAX_MEMORY_SHARE)
        return 'shared VM memory above 85% (invalid co-located generator run)'
      const cores = values['k6-cpuset'].split(',').reduce((n, part) => {
        const [a, b] = part.split('-').map(Number)
        return n + (b === undefined ? 1 : b - a + 1)
      }, 0)
      if (recent.length >= 3) {
        const k = rates(recent).k6
        if (k.observedSeconds >= 2 && k.cpu > cores * 0.7)
          return 'k6 CPU above 70% of assigned cores (invalid generator-limited run)'
      }
      return null
    }
    const now = Date.now() / 1000
    const [last] = (await samplesBetween(now - 5, now)).slice(-1)
    if (last && (last.memTotal - last.memAvailable) / last.memTotal > MAX_MEMORY_SHARE)
      return 'memory above 85%'
    if (last && last.diskUsed / last.diskTotal > MAX_DISK_SHARE) return 'disk above 80%'
    if (values.plan || values['past-capacity']) return null
    // Any kind over its target for the last 30 seconds.
    const recent = logged.filter((r) => r.t > now - WINDOW_S - 5)
    for (const kind of new Set(recent.map((r) => r.kind))) {
      const durations = recent.filter((r) => r.kind === kind).map((r) => r.duration * 1000)
      if (durations.length >= 5 && percentile(durations, 95) > targetMs(kind))
        return `${kind} over target for 30 s`
    }
    return null
  }
  // The log is read as the run goes, so no read is larger than the sampler's memory: a
  // fast step writes tens of MB of it a minute.
  const { summary, aborted } = await runK6(plan, files, watch)
  // Caddy writes its log as requests end; the last ones may take a moment.
  await Bun.sleep(2000)
  await readLog()
  const ended = Date.now() / 1000
  const results: StepResult[] = []
  for (const step of plan) {
    const requests = logged.filter((r) => r.step === step.name && r.t >= began)
    const from = requests.length ? requestBounds(requests).first : began
    const to = requests.length ? requestBounds(requests).last : ended
    const result: StepResult = {
      step,
      summary,
      requests,
      samples: await samplesBetween(from, to),
      aborted: aborted !== null,
    }
    results.push(result)
    const text = report(result)
    console.log(text)
    writeFileSync(join(files.out, `${step.name}.txt`), text)
    writeFileSync(join(files.out, `${step.name}.samples.json`), JSON.stringify(result.samples))
    writeFileSync(join(files.out, `${step.name}.summary.json`), JSON.stringify(summary))
    writeFileSync(join(files.out, `${step.name}.requests.json`), JSON.stringify(result.requests))
    const missed = misses(result)
    writeFileSync(
      join(files.out, `${step.name}.validity.json`),
      JSON.stringify(
        {
          generatorLimited:
            aborted?.includes('k6 CPU') ||
            aborted?.includes('shared VM memory') ||
            missed.some((reason) => reason.includes('dropped iterations')),
          aborted,
          missed,
        },
        null,
        2,
      ),
    )
  }
  if (aborted) console.log(`[stress] Stopped early: ${aborted}`)
  return { results, aborted }
}

// The app's memory before any load, from the sampler's last seconds of samples.
async function idleMemory(): Promise<string> {
  await Bun.sleep(10_000)
  const now = Date.now() / 1000
  const samples = await samplesBetween(now - 5, now)
  const app = samples.at(-1)?.containers.app
  if (!app) return 'Idle: no samples'
  const text =
    `Idle app (${values.app}): memory ${mb(app.memory)} MB (anon ${mb(app.anon)}, cache ` +
    `${mb(app.file)}), RSS ${mb(app.rss)} MB`
  console.log(`[stress] ${text}`)
  return text
}

async function main() {
  const paths = await dataset(name, values['dataset-date'])
  if (!target.remote) {
    if (!values.load && values['replica-dir']) {
      const current = spawnSync('docker', ['inspect', 'snowtime-bench-litestream-1'], {
        encoding: 'utf8',
      })
      if (current.status !== 0) throw new Error('Cannot inspect the prepared replication stack')
      const inspection = JSON.parse(current.stdout)[0]
      const mounts = inspection.Mounts as {
        Destination: string
        Source: string
      }[]
      if (
        mounts
          .find((mount) => mount.Destination === '/replica')
          ?.Source.replace(/^\/host_mnt(?=\/)/, '') !==
        resolve(values['replica-dir']).replace(/^\/host_mnt(?=\/)/, '')
      )
        throw new Error("--no-load must retain the prepared stack's replica directory")
      if (!inspection.State.Running)
        throw new Error('The prepared replication process must be running')
      if (values['litestream-image'] && inspection.Config.Image !== values['litestream-image'])
        throw new Error('--no-load must retain the prepared Litestream image')
      const memory = Number(values['litestream-memory'].replace(/m$/i, '')) * 1024 * 1024
      if (inspection.HostConfig.Memory !== memory)
        throw new Error('--no-load must retain the prepared Litestream memory limit')
    }
    if (values.build) buildImages()
    const tls = join(CACHE, 'stress', 'edge', 'tls')
    if (values.direct) directTls(tls)
    const settings = {
      ...(values['replica-dir'] && { BENCH_REPLICA_DIR: resolve(values['replica-dir']) }),
      ...(values['litestream-image'] && { BENCH_LITESTREAM_IMAGE: values['litestream-image'] }),
      BENCH_LITESTREAM_MEMORY: values['litestream-memory'],
      BENCH_APP_CPUSET: values['app-cpuset'],
      BENCH_SAMPLER_CPUSET: values['sampler-cpuset'],
      BENCH_TOKIO_RUNTIME: values.runtime,
      BENCH_QUEUE_MAX_WAITING: values['queue-max-waiting'],
      BENCH_QUEUE_TIMEOUT_MS: values['queue-timeout-ms'],
      BENCH_READ_CONNECTIONS: values['read-connections'],
      ...(values.direct && { BENCH_DIRECT_TLS: tls }),
      ...(values.memory && { BENCH_APP_MEMORY: values.memory }),
      ...(values['caddy-memory'] && { BENCH_CADDY_MEMORY: values['caddy-memory'] }),
      ...(values.smol && { BENCH_BUN_OPTIONS: '--smol' }),
      ...(values['max-requests'] && { BENCH_MAX_REQUESTS: values['max-requests'] }),
      ...(values['try-duration'] && { BENCH_TRY_DURATION: values['try-duration'] }),
      ...(values['caddy-cpuset'] && { BENCH_CADDY_CPUSET: values['caddy-cpuset'] }),
      ...(values['caddy-config'] && { BENCH_CADDY_CONFIG: resolve(values['caddy-config']) }),
    }
    if (!values['replica-dir']) {
      const stop = Bun.spawnSync(['docker', 'stop', 'snowtime-bench-litestream-1'], {
        stdout: 'ignore',
        stderr: 'ignore',
      })
      if (stop.exitCode !== 0) console.log('[stress] No replication container to stop.')
    }
    if (values.load) {
      compose(['up', '-d', '--no-start'], settings)
      loadDataset(paths.database, settings)
    }
    startStack(settings, !values.load && !!values['replica-dir'])
    if (values.direct) target.address = directAddress()
  }
  // The log keeps earlier runs' requests; this one reads only its own.
  logOffset = (await sampler<{ offset: number }>('/_bench/log?offset=end')).offset
  if (Number(values['warmup-seconds']) > 0) {
    console.log(
      `[stress] Waiting ${values['warmup-seconds']} s for startup/replication before measuring`,
    )
    await Bun.sleep(Number(values['warmup-seconds']) * 1000)
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const out = join(
    CACHE,
    'stress',
    'runs',
    `${stamp}-${name}-${values.run}${values.label ? `-${values.label}` : ''}`,
  )
  mkdirSync(out, { recursive: true })
  outputDirectory = out
  writeFileSync(join(out, 'settings.json'), JSON.stringify(values, null, 2))
  if (values['replica-dir'] && !target.remote && values.load) {
    console.log('[stress] Waiting for initial replication before measuring')
    const deadline = Date.now() + 15 * 60 * 1000
    for (;;) {
      checkReplicationRunning()
      const logs = spawnSync('docker', ['logs', 'snowtime-bench-litestream-1'], {
        encoding: 'utf8',
      })
      const text = logs.stdout + logs.stderr
      if (
        text
          .split('\n')
          .some(
            (line) =>
              (line.includes('compaction complete') &&
                line.includes('level=1') &&
                line.includes('txid.min=0000000000000001')) ||
              (line.includes('ltx file uploaded') &&
                line.includes('level=0') &&
                line.includes('minTXID=0000000000000001') &&
                line.includes('maxTXID=0000000000000001')),
          )
      )
        break
      if (Date.now() >= deadline)
        throw new Error('Initial replication did not finish in 15 minutes')
      await Bun.sleep(5000)
    }
  }
  const idle = await idleMemory()
  const users = JSON.parse(readFileSync(paths.users, 'utf8')) as BenchUser[]
  // A member of a mid-sized company records, so its pages are typical.
  const recorder =
    users.find((u) => u.role === 'member' && u.projectIds.length > 0 && u.slug !== 'lumen') ??
    users.find((u) => u.slug === 'lumen' && u.role === 'member')!
  writeFileSync(join(out, 'idle.txt'), idle)
  // A given recording replays as it is, such as one cut down to the calls the native backend
  // serves (native/bench/api-recording.ts).
  let recording: Recording
  if (values.recording) {
    recording = JSON.parse(readFileSync(values.recording, 'utf8')) as Recording
  } else {
    console.log(`[stress] Recording the actions as ${recorder.email} ...`)
    recording = await record({
      origin: target.origin,
      user: recorder,
      secret: target.secret,
      resolve: target.chromeAddress,
      ignoreHTTPSErrors: target.insecure,
    })
  }
  const recordingFile = join(out, 'recording.json')
  writeFileSync(recordingFile, JSON.stringify(recording, null, 1))
  const files = { recording: recordingFile, users: paths.users, out }
  const stepSeconds = Number(values['step-seconds'])

  function checkReplicationRunning() {
    const inspection = spawnSync(
      'docker',
      ['inspect', '--format', '{{json .State}}', 'snowtime-bench-litestream-1'],
      { encoding: 'utf8' },
    )
    if (inspection.status !== 0) throw new Error('Cannot inspect Litestream startup')
    const state = JSON.parse(inspection.stdout)
    if (!state.Running) {
      writeFileSync(join(out, 'litestream-state.json'), JSON.stringify(state, null, 2))
      throw new Error(
        `Litestream stopped during startup: OOM=${state.OOMKilled}, exit=${state.ExitCode}`,
      )
    }
  }

  async function waitInitialCompaction() {
    if (target.remote || !values['replica-dir'] || !values.load) return
    console.log('[stress] Waiting for initial level-two replication compaction before measuring')
    const deadline = Date.now() + 15 * 60 * 1000
    for (;;) {
      checkReplicationRunning()
      const logs = spawnSync('docker', ['logs', 'snowtime-bench-litestream-1'], {
        encoding: 'utf8',
      })
      if (
        (logs.stdout + logs.stderr)
          .split('\n')
          .some(
            (line) =>
              line.includes('compaction complete') &&
              line.includes('level=2') &&
              line.includes('txid.min=0000000000000001'),
          )
      ) {
        console.log('[stress] Initial replication compactions complete')
        return
      }
      if (Date.now() >= deadline) throw new Error('Initial compaction did not finish in 15 minutes')
      await Bun.sleep(5000)
    }
  }
  if (values.run !== 'ramp' && !target.remote && values['replica-dir']) {
    // A first write makes Litestream eligible to compact the initial database copy.
    await runPlan([{ name: 'replication-warmup', users: 500, seconds: 30 }], files)
    await waitInitialCompaction()
  }

  if (values.plan) {
    const plan = JSON.parse(readFileSync(resolve(values.plan), 'utf8')) as Step[]
    await runPlan(plan, files)
  } else if (values.run === 'fixed' || values.run === 'calibration') {
    const usersCount = Number(values.users ?? (values.run === 'calibration' ? 100 : 200))
    await runPlan(
      [{ name: 'fixed', users: usersCount, seconds: Number(values.seconds ?? 300) }],
      files,
    )
  } else if (values.run === 'ramp') {
    const from = Number(values.from ?? 0)
    const steps = RAMP.filter((n) => n >= from)
    // A ramp that skips the low steps warms the app up first, unjudged.
    if (from > 0) {
      console.log(`\n[stress] Warming up at ${Math.round(from / 2)} users for 30 s`)
      await runPlan([{ name: 'warmup', users: Math.round(from / 2), seconds: 30 }], files)
      await waitInitialCompaction()
    }
    let lastGood: number | undefined
    let firstFail: number | undefined
    function capacity(users: number | null, generatorLimited: boolean, reason?: string) {
      writeFileSync(
        join(out, 'capacity.json'),
        JSON.stringify({ users, firstFail, generatorLimited, reason }, null, 2),
      )
    }
    for (const [i, count] of steps.entries()) {
      const { results, aborted } = await runPlan(
        [{ name: `u${count}`, users: count, seconds: stepSeconds }],
        files,
      )
      const missed = misses(results[0])
      if (missed.length === 0 && !aborted) {
        lastGood = count
        continue
      }
      firstFail = count
      console.log(`\n[stress] ${count} users missed: ${aborted ?? missed.join('; ')}`)
      if (
        aborted?.includes('k6 CPU') ||
        aborted?.includes('shared VM memory') ||
        missed.some((m) => m.includes('dropped iterations'))
      ) {
        capacity(null, true, aborted ?? missed.join('; '))
        return
      }
      if (target.remote && i >= 2) {
        console.log(`[stress] Dropping to ${steps[i - 2]} users for 2 minutes`)
        await runPlan([{ name: `cool${steps[i - 2]}`, users: steps[i - 2], seconds: 120 }], files)
      }
      break
    }
    if (lastGood === undefined && values['past-capacity']) {
      lastGood = RAMP.filter((users) => users < from).at(-1)
    }
    if (lastGood === undefined) {
      console.log('[stress] Not even the first step held.')
      capacity(null, false, 'First ramp step failed')
      return
    }
    // Validate lower offers until one holds; growing WAL can make several earlier steps fail.
    const holds = RAMP.filter((n) => n <= lastGood).toReversed()
    for (const users of holds) {
      console.log(`\n[stress] Holding ${users} users for ${values['hold-seconds']} s`)
      const { results, aborted } = await runPlan(
        [{ name: `hold${users}`, users, seconds: Number(values['hold-seconds']) }],
        files,
      )
      const missed = misses(results[0])
      if (
        aborted?.includes('k6 CPU') ||
        aborted?.includes('shared VM memory') ||
        missed.some((m) => m.includes('dropped iterations'))
      ) {
        capacity(null, true, aborted ?? missed.join('; '))
        return
      }
      if (missed.length === 0 && !aborted) {
        console.log(`\n[stress] Capacity on ${name}: ${users} active users`)
        capacity(users, false)
        if (values['past-capacity']) {
          await runPlan(
            [
              { name: 'x2', users: users * 2, seconds: stepSeconds },
              { name: 'x4', users: users * 4, seconds: stepSeconds },
              { name: 'recover', users, seconds: Number(values['hold-seconds']) },
            ],
            files,
          )
        }
        return
      }
      console.log(`\n[stress] The hold at ${users} users missed: ${missed.join('; ')}`)
    }
    capacity(null, false, 'All hold candidates failed')
  } else if (values.run === 'overload') {
    if (target.remote) throw new Error('[stress] Overload runs locally only.')
    const knee = Number(values.users ?? 0)
    if (!knee) throw new Error('[stress] --run=overload needs --users=<knee>')
    await runPlan(
      [
        { name: 'knee', users: knee, seconds: 120 },
        { name: 'x2', users: knee * 2, seconds: 300 },
        { name: 'x4', users: knee * 4, seconds: 300 },
        { name: 'recover', users: knee, seconds: 300 },
      ],
      files,
    )
  } else if (values.run === 'kinds') {
    // Isolate page, API, and auth kinds so their CPU totals do not mix.
    const perSecond = Number(values.users ?? 2)
    const actions = [
      'open',
      'return',
      'timer',
      'edit',
      'reports-week',
      'reports-month',
      'reports-year',
      'export',
      'sign-in',
    ].filter((action) =>
      // A cut-down recording may leave an action without requests.
      (action === 'timer' ? ['start', 'stop'] : [action]).some(
        (a) => (recording.actions[a as keyof Recording['actions']] ?? []).length > 0,
      ),
    )
    const split = {
      ...recording,
      actions: { ...recording.actions } as Record<string, Recording['actions']['open']>,
    }
    const kinds = actions.flatMap((action) => {
      if (action === 'timer') return [action]
      const requests = split.actions[action]
      const groups = new Map<string, typeof requests>()
      for (const request of requests) {
        const type = request.path.startsWith('/api/auth/')
          ? 'auth'
          : request.path.startsWith('/api/v1/') || request.path.startsWith('/_serverFn/')
            ? 'api'
            : 'page'
        const group = groups.get(type) ?? []
        group.push(request)
        groups.set(type, group)
      }
      return [...groups.entries()].map(([type, requests]) => {
        const key = `${action}:${type}`
        split.actions[key] = requests
        return key
      })
    })
    writeFileSync(files.recording, JSON.stringify(split, null, 1))
    const { results } = await runPlan(
      kinds.map((action) => ({
        name: action.replaceAll(':', '-'),
        users: 0,
        seconds: Number(values.seconds ?? 60),
        action,
        perHour: perSecond * 3600,
      })),
      files,
    )
    const rows = results.map((r) => {
      const { app, caddy } = rates(r.samples)
      const sent = metric(r.summary, `http_reqs{step:${r.step.name}}`, 'count')
      const actionsRun = metric(r.summary, `bench_action_duration{step:${r.step.name}}`, 'count')
      const server = r.requests.map((q) => q.duration * 1000)
      return [
        r.step.name,
        `${actionsRun}`,
        (sent / Math.max(1, actionsRun)).toFixed(1),
        (app.cpuUsec / Math.max(1, actionsRun) / 1000).toFixed(1),
        (app.cpuUsec / Math.max(1, sent) / 1000).toFixed(1),
        (caddy.cpuUsec / Math.max(1, sent) / 1000).toFixed(2),
        ms(percentile(server, 50)),
        ms(percentile(server, 95)),
      ]
    })
    const text = table(
      [
        'Action',
        'actions',
        'req/action',
        'CPU ms/action',
        'CPU ms/req',
        'Caddy ms/req',
        'srv p50',
        'srv p95',
      ],
      rows,
    )
    console.log(`\n${text}`)
    writeFileSync(join(out, 'kinds.txt'), text)
  } else {
    throw new Error(`[stress] Unknown --run=${values.run}`)
  }
  console.log(`\n[stress] Results in ${relative(ROOT, out)}`)
}

const releaseStack = target.remote ? () => {} : reserveStack()
process.once('exit', releaseStack)
try {
  if (!target.remote) checkOtherSessions()
  await main()
} finally {
  if (!target.remote && outputDirectory) {
    for (const service of [
      'app',
      'caddy',
      'sampler',
      ...(values['replica-dir'] ? ['litestream'] : []),
    ]) {
      const logs = spawnSync('docker', ['logs', '--timestamps', `snowtime-bench-${service}-1`], {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      })
      writeFileSync(join(outputDirectory, `${service}.log`), logs.stdout + logs.stderr)
      const state = spawnSync(
        'docker',
        ['inspect', '-f', '{{json .State}}', `snowtime-bench-${service}-1`],
        { encoding: 'utf8' },
      )
      writeFileSync(join(outputDirectory, `${service}.state.json`), state.stdout)
    }
    const images = spawnSync(
      'docker',
      [
        'image',
        'inspect',
        '--format',
        '{{.RepoTags}} {{.Id}}',
        'snowtime-native:bench',
        'snowtime-app:bench',
        'snowtime-caddy:bench',
        'snowtime-sampler:bench',
        ...(values['replica-dir']
          ? [values['litestream-image'] ?? 'litestream/litestream:0.5.0']
          : []),
      ],
      { encoding: 'utf8' },
    )
    writeFileSync(join(outputDirectory, 'images.txt'), images.stdout)
  }
  releaseStack()
  process.removeListener('exit', releaseStack)
}
