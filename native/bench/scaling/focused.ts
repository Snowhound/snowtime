// Pairs connection modes on one prepared dataset; startup is measured separately.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { CACHE, ROOT } from '../../../perf/lib/database'

const { values } = parseArgs({
  options: {
    dataset: { type: 'string', default: 'M' },
    'dataset-date': { type: 'string', default: '2026-10-05' },
    prepared: { type: 'boolean', default: false },
    resume: { type: 'boolean', default: false },
    cores: { type: 'string', default: '1,8' },
    'litestream-image': { type: 'string', default: 'litestream/litestream:0.5.15' },
    typescript: { type: 'boolean', default: false },
  },
})
const dataset = values.dataset
if (!['M', 'L'].includes(dataset)) throw new Error('--dataset is M or L')
const sizes = values.cores.split(',').map(Number)
if (sizes.some((cores) => ![1, 8].includes(cores))) throw new Error('--cores contains 1 or 8')
const runs = join(CACHE, 'stress', 'runs')
const output = join(CACHE, 'stress', '081-focused-matrix.json')
const cells: Record<string, unknown>[] = existsSync(output)
  ? JSON.parse(readFileSync(output, 'utf8'))
  : []
let prepared = values.prepared
let replica: string
if (prepared) {
  const current = spawnSync('docker', ['inspect', 'snowtime-bench-litestream-1'], {
    encoding: 'utf8',
  })
  if (current.status !== 0) throw new Error('Cannot inspect the prepared replica')
  const mounts = JSON.parse(current.stdout)[0].Mounts as { Destination: string; Source: string }[]
  replica = mounts
    .find((mount) => mount.Destination === '/replica')!
    .Source.replace(/^\/host_mnt(?=\/)/, '')
} else {
  replica = join(CACHE, 'stress', 'replica', `081-focused-${dataset}-${Date.now()}`)
  mkdirSync(replica, { recursive: true, mode: 0o777 })
  if (spawnSync('chmod', ['777', replica]).status !== 0) throw new Error('Cannot prepare replica')
}
function findRaw(label: string) {
  const name = readdirSync(runs)
    .filter((name) => name.includes(`-${dataset}-`) && name.endsWith(`-${label}`))
    .sort()
    .at(-1)
  return name ? join(runs, name) : undefined
}
function latest(label: string) {
  const raw = findRaw(label)
  if (!raw) throw new Error(`No raw output for ${label}`)
  return raw
}
function invoke(
  app: string,
  cores: number,
  readers: string,
  run: string,
  label: string,
  extra: string[],
) {
  const replicationMiB = dataset === 'L' ? 512 : 128
  const serverCores = cores === 1 ? '1' : '0-7'
  const child = spawnSync(
    'bun',
    [
      join(ROOT, 'perf/stress/stress.ts'),
      `--app=${app}`,
      `--dataset=${dataset}`,
      `--dataset-date=${values['dataset-date']}`,
      `--litestream-image=${values['litestream-image']}`,
      `--litestream-memory=${replicationMiB}m`,
      `--replica-dir=${replica}`,
      '--recording=perf/.cache/stress/slice-pages.json',
      '--encoding=gzip',
      '--no-build',
      ...(prepared ? ['--no-load'] : []),
      `--warmup-seconds=${prepared ? 0 : 30}`,
      `--memory=${cores * 2048 - 384 - replicationMiB - (app === 'ts' ? 256 : 0)}m`,
      '--caddy-memory=256m',
      `--app-cpuset=${serverCores}`,
      `--caddy-cpuset=${serverCores}`,
      `--sampler-cpuset=${serverCores}`,
      `--k6-cpuset=${cores === 1 ? '2-9' : '8-9'}`,
      `--read-connections=${readers}`,
      ...(app === 'native' ? ['--direct'] : []),
      `--run=${run}`,
      `--label=${label}`,
      ...extra,
    ],
    { cwd: ROOT, stdio: 'inherit' },
  )
  if (child.status !== 0) throw new Error(`Benchmark exited ${child.status}`)
  prepared = true
  return latest(label)
}
function record(cell: Record<string, unknown>) {
  const previous = cells.findIndex(
    (value) =>
      value.dataset === dataset &&
      value.cores === cell.cores &&
      value.app === cell.app &&
      value.readers === cell.readers,
  )
  if (previous < 0) cells.push(cell)
  else cells[previous] = cell
  writeFileSync(output, JSON.stringify(cells, null, 2))
}
function ramp(app: string, cores: number, readers: string, from: number, label: string) {
  const saved = cells.find(
    (cell) =>
      cell.dataset === dataset &&
      cell.cores === cores &&
      cell.app === app &&
      cell.readers === readers,
  )
  if (values.resume && saved && (saved.users || saved.generatorLimited)) {
    console.log(`[focused] Retaining completed ramp: ${dataset} ${label}`)
    return saved
  }
  const previous = findRaw(`${label}-ramp`)
  if (
    values.resume &&
    previous &&
    existsSync(join(previous, 'capacity.json')) &&
    existsSync(join(previous, 'images.txt'))
  ) {
    const decision = JSON.parse(readFileSync(join(previous, 'capacity.json'), 'utf8'))
    if (decision.users || decision.generatorLimited) {
      record({ dataset, cores, app, readers, label, protocol: 'prepared', replica, ...decision })
      return decision
    }
  }
  let decision
  do {
    const raw = invoke(app, cores, readers, 'ramp', `${label}-ramp`, [
      `--from=${from}`,
      '--step-seconds=60',
      '--hold-seconds=120',
    ])
    decision = JSON.parse(readFileSync(join(raw, 'capacity.json'), 'utf8'))
    if (decision.generatorLimited || decision.users || from === 50) break
    from = Math.max(50, Math.floor(from / 2))
  } while (from >= 50)
  record({ dataset, cores, app, readers, label, protocol: 'prepared', replica, ...decision })
  return decision
}
for (const cores of sizes) {
  let from = dataset === 'M' ? (cores === 1 ? 20000 : 25000) : 4000
  for (const readers of ['0', 'auto']) {
    const mode = readers === '0' ? 'single' : 'pool'
    const label = `081-focused-native-${mode}-${cores}c-ls0515`
    const decision = ramp('native', cores, readers, from, label)
    if (decision.generatorLimited) break
    if (!decision.users) continue
    from = Math.max(50, Math.floor(decision.users / 2))
    if (cores === 1) {
      let limited = false
      for (const users of [1000, 5000]) {
        const fixedLabel = `${label}-fixed${users}`
        const previous = findRaw(fixedLabel)
        const raw =
          values.resume &&
          previous &&
          existsSync(join(previous, 'fixed.validity.json')) &&
          existsSync(join(previous, 'images.txt'))
            ? previous
            : invoke('native', cores, readers, 'fixed', fixedLabel, [
                `--users=${users}`,
                '--seconds=120',
              ])
        if (JSON.parse(readFileSync(join(raw, 'fixed.validity.json'), 'utf8')).generatorLimited) {
          limited = true
          break
        }
      }
      if (limited) break
      const previous = findRaw(`${label}-kinds`)
      const complete =
        previous &&
        existsSync(join(previous, 'kinds.txt')) &&
        existsSync(join(previous, 'images.txt')) &&
        readdirSync(previous).filter(
          (name) => name.endsWith('.validity.json') && !name.startsWith('replication-warmup.'),
        ).length === 11
      if (!(values.resume && complete))
        invoke('native', cores, readers, 'kinds', `${label}-kinds`, ['--users=2', '--seconds=30'])
    }
  }
}
if (values.typescript)
  ramp('ts', 8, '0', dataset === 'M' ? 15000 : 10000, '081-focused-ts-single-8c-ls0515')
