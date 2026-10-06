// Runs one matrix cell, beginning with a ramp. Provisioning and server deployment are external.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { ROOT, CACHE } from '../../../perf/lib/database'

const { values } = parseArgs({
  options: {
    app: { type: 'string', default: 'native' },
    dataset: { type: 'string', default: 'M' },
    'litestream-image': { type: 'string', default: 'litestream/litestream:0.5.15' },
    'dataset-date': { type: 'string', default: new Date().toISOString().slice(0, 10) },
    cores: { type: 'string', default: '1' },
    memory: { type: 'string' },
    'caddy-memory': { type: 'string', default: '256m' },
    'litestream-memory': { type: 'string' },
    readers: { type: 'string', default: '0' },
    replication: { type: 'boolean', default: true },
    from: { type: 'string', default: '10000' },
    'step-seconds': { type: 'string', default: '60' },
    'hold-seconds': { type: 'string', default: '120' },
    recording: { type: 'string', default: 'perf/.cache/stress/slice-pages.json' },
    label: { type: 'string' },
    remote: { type: 'boolean', default: false },
    'sampler-url': { type: 'string' },
    fixed: { type: 'string' },
  },
  allowNegative: true,
})
const cores = Number(values.cores)
if (![1, 2, 4, 8].includes(cores)) throw new Error('--cores is 1, 2, 4, or 8')
const replicationMiB = Number(
  (values['litestream-memory'] ?? (values.dataset === 'L' ? '512' : '128')).replace(/m$/i, ''),
)
if (!Number.isInteger(replicationMiB) || replicationMiB < 1)
  throw new Error('--litestream-memory is MiB')
const proxyMiB = Number(values['caddy-memory'].replace(/m$/i, ''))
if (!Number.isInteger(proxyMiB) || proxyMiB < 1) throw new Error('--caddy-memory is MiB')
const memory =
  values.memory ?? `${cores * 2048 - 384 - replicationMiB - (values.app === 'ts' ? proxyMiB : 0)}m`
const label =
  values.label ??
  `081-load-${values.app}-${values.readers === '0' ? 'single' : 'pool'}-${cores}c-${values.replication ? 'rep' : 'no-rep'}`
const serverCores = cores === 1 ? '1' : `0-${cores - 1}`
const generatorCores = `${cores === 1 ? 2 : cores}-9`
const base = [
  'run',
  'perf:stress',
  `--app=${values.app}`,
  `--dataset=${values.dataset}`,
  `--litestream-image=${values['litestream-image']}`,
  `--litestream-memory=${replicationMiB}m`,
  `--dataset-date=${values['dataset-date']}`,
  `--recording=${values.recording}`,
  '--encoding=gzip',
  '--no-build',
  `--memory=${memory}`,
  `--caddy-memory=${proxyMiB}m`,
  `--read-connections=${values.readers}`,
  `--app-cpuset=${serverCores}`,
  `--caddy-cpuset=${serverCores}`,
  `--sampler-cpuset=${serverCores}`,
  `--k6-cpuset=${generatorCores}`,
  `--warmup-seconds=${values.replication ? 60 : 30}`,
  ...(values.app === 'native' ? ['--direct'] : []),
  ...(values.remote ? ['--remote'] : []),
  ...(values['sampler-url'] ? [`--sampler-url=${values['sampler-url']}`] : []),
]
function run(args: string[]) {
  const runBase = [...base]
  if (values.replication && !values.remote) {
    const replica = join(CACHE, 'stress', 'replica', `${label}-${Date.now()}`)
    mkdirSync(replica, { recursive: true, mode: 0o777 })
    // Replicas contain generated data; the container runs as UID 10001.
    const permission = spawnSync('chmod', ['777', replica], { stdio: 'inherit' })
    if (permission.status !== 0) throw new Error('Cannot prepare replica permissions')
    runBase.push(`--replica-dir=${replica}`)
  }
  const child = spawnSync('bun', [...runBase, ...args], { cwd: ROOT, stdio: 'inherit' })
  if (child.status !== 0) throw new Error(`Benchmark exited ${child.status}`)
}
run([
  '--run=ramp',
  `--from=${values.from}`,
  `--step-seconds=${values['step-seconds']}`,
  `--hold-seconds=${values['hold-seconds']}`,
  `--label=${label}-ramp`,
])
if (values.fixed) {
  const runs = join(CACHE, 'stress', 'runs')
  const latest = readdirSync(runs)
    .filter((name) => name.endsWith(`${label}-ramp`))
    .sort()
    .at(-1)
  if (!latest) throw new Error('No ramp output found')
  const decision = JSON.parse(readFileSync(join(runs, latest, 'capacity.json'), 'utf8'))
  if (decision.generatorLimited || !decision.users)
    throw new Error('No valid passing hold; fixed loads skipped')
  for (const users of values.fixed.split(',').map(Number)) {
    if (users > decision.users)
      throw new Error(`Fixed ${users} exceeds passing hold ${decision.users}`)
    run(['--run=fixed', `--users=${users}`, '--seconds=120', `--label=${label}-fixed${users}`])
  }
}
writeFileSync(
  join(CACHE, 'stress', `${label}-cell.json`),
  JSON.stringify({ ...values, memory }, null, 2),
)
