// Serializes the single-connection and pool phases; each stress invocation owns the shared lock.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { CACHE, ROOT } from '../../../perf/lib/database'

const { values } = parseArgs({
  options: {
    'litestream-image': { type: 'string', default: 'litestream/litestream:0.5.15' },
    phase: { type: 'string', default: 'single' },
    'dataset-date': { type: 'string', default: new Date().toISOString().slice(0, 10) },
    cores: { type: 'string', default: '1,2,4,8' },
    datasets: { type: 'string', default: 'M,L' },
  },
})
if (!['single', 'pool'].includes(values.phase)) throw new Error('--phase is single or pool')
const runs = join(CACHE, 'stress', 'runs')
const matrixFile = join(CACHE, 'stress', `081-${values.phase}-matrix.json`)
const cells: Record<string, unknown>[] = existsSync(matrixFile)
  ? JSON.parse(readFileSync(matrixFile, 'utf8'))
  : []
function invoke(file: string, args: string[]) {
  const result = spawnSync('bun', [file, ...args], { cwd: ROOT, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${file} exited ${result.status}`)
}
function latest(label: string) {
  const name = readdirSync(runs)
    .filter((n) => n.endsWith(`-${label}`))
    .sort()
    .at(-1)
  if (!name) throw new Error(`No raw folder for ${label}`)
  return join(runs, name)
}
function stress(
  app: string,
  dataset: string,
  cores: number,
  readers: string,
  run: string,
  label: string,
  extra: string[],
  replication = true,
) {
  const replica = join(CACHE, 'stress', 'replica', `${label}-${Date.now()}`)
  if (replication) mkdirSync(replica, { recursive: true, mode: 0o777 })
  if (replication) {
    const permission = spawnSync('chmod', ['777', replica])
    if (permission.status !== 0) throw new Error('Cannot prepare replica')
  }
  const replicationMiB = dataset === 'L' ? 512 : 128
  const appCores = cores === 1 ? '1' : `0-${cores - 1}`
  invoke('perf/stress/stress.ts', [
    `--app=${app}`,
    `--dataset=${dataset}`,
    `--litestream-image=${values['litestream-image']}`,
    `--litestream-memory=${replicationMiB}m`,
    `--dataset-date=${values['dataset-date']}`,
    `--run=${run}`,
    `--label=${label}`,
    '--no-build',
    '--recording=perf/.cache/stress/slice-pages.json',
    '--encoding=gzip',
    `--memory=${cores * 2048 - 384 - replicationMiB - (app === 'ts' ? 256 : 0)}m`,
    '--caddy-memory=256m',
    `--app-cpuset=${appCores}`,
    `--caddy-cpuset=${appCores}`,
    `--sampler-cpuset=${appCores}`,
    `--k6-cpuset=${cores === 1 ? 2 : cores}-9`,
    `--read-connections=${readers}`,
    `--warmup-seconds=${replication ? 60 : 30}`,
    ...(replication ? [`--replica-dir=${replica}`] : []),
    ...(app === 'native' ? ['--direct'] : []),
    ...extra,
  ])
  if (run === 'fixed')
    return JSON.parse(readFileSync(join(latest(label), 'fixed.validity.json'), 'utf8'))
  return { generatorLimited: false }
}
for (const dataset of values.datasets.split(',')) {
  if (!['M', 'L'].includes(dataset)) throw new Error('--datasets contains M or L')
  for (const cores of values.cores.split(',').map(Number)) {
    if (![1, 2, 4, 8].includes(cores)) throw new Error('Core sizes are 1,2,4,8')
    for (const app of values.phase === 'single' ? ['native', 'ts'] : ['native']) {
      const readers = values.phase === 'pool' ? 'auto' : '0'
      const version = values['litestream-image'].split(':').at(-1)!.replaceAll('.', '')
      const label = `081-load-${app}-${values.phase}-${cores}c-ls${version}`
      let from = dataset === 'M' ? 10000 : 1000
      let decision
      do {
        invoke('native/bench/scaling/run.ts', [
          `--app=${app}`,
          `--dataset=${dataset}`,
          `--litestream-image=${values['litestream-image']}`,
          `--dataset-date=${values['dataset-date']}`,
          `--cores=${cores}`,
          `--readers=${readers}`,
          `--from=${from}`,
          `--label=${label}`,
        ])
        decision = JSON.parse(readFileSync(join(latest(`${label}-ramp`), 'capacity.json'), 'utf8'))
        if (decision.generatorLimited || decision.users || from === 50) break
        from = Math.max(50, Math.floor(from / 2))
      } while (from >= 50)
      const previous = cells.findIndex(
        (cell) =>
          cell.dataset === dataset &&
          cell.cores === cores &&
          cell.app === app &&
          cell.readers === readers,
      )
      const cell = { dataset, cores, app, readers, label, ...decision }
      if (previous < 0) cells.push(cell)
      else cells[previous] = cell
      writeFileSync(matrixFile, JSON.stringify(cells, null, 2))
      if (decision.generatorLimited || !decision.users) continue
      if (cores === 1) {
        // Matched fixed offers include overloads; a missed target is recorded, never called capacity.
        let generatorLimited = false
        for (const users of [1000, 5000]) {
          const validity = stress(app, dataset, cores, readers, 'fixed', `${label}-fixed${users}`, [
            `--users=${users}`,
            '--seconds=120',
          ])
          if (validity.generatorLimited) {
            generatorLimited = true
            break
          }
        }
        if (generatorLimited) continue
        stress(app, dataset, cores, readers, 'kinds', `${label}-kinds`, [
          '--users=2',
          '--seconds=30',
        ])
      }
    }
  }
}
