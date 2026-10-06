// Records an existing local replication startup under the shared benchmark guard.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { reserveStack, checkOtherSessions } from '../../../perf/stress/lock'

const { values } = parseArgs({
  options: { out: { type: 'string' }, timeout: { type: 'string', default: '900' } },
})
if (!values.out) throw new Error('Set --out to the startup diagnostic raw folder')
const out = resolve(values.out)
mkdirSync(out, { recursive: true })
const release = reserveStack()
process.once('exit', release)
function docker(args: string[]) {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr || `docker exited ${result.status}`)
  return args[0] === 'logs' ? result.stdout + result.stderr : result.stdout
}
const container = 'snowtime-bench-litestream-1'
const began = Date.now()
let completed = false
try {
  checkOtherSessions()
  for (;;) {
    const state = JSON.parse(docker(['inspect', '--format', '{{json .State}}', container]))
    const log = docker(['logs', '--timestamps', container])
    const memory = state.Running
      ? docker([
          'exec',
          container,
          'sh',
          '-c',
          'cat /proc/1/status; cat /sys/fs/cgroup/memory.pressure; cat /sys/fs/cgroup/memory.events; cat /sys/fs/cgroup/memory.swap.current',
        ])
      : ''
    appendFileSync(
      join(out, 'observations.jsonl'),
      JSON.stringify({ t: Date.now() / 1000, state, memory }) + '\n',
    )
    writeFileSync(join(out, 'litestream.log'), log)
    writeFileSync(join(out, 'state.json'), JSON.stringify(state, null, 2))
    if (!state.Running) throw new Error(`Litestream stopped, OOM=${state.OOMKilled}`)
    if (
      log
        .split('\n')
        .some(
          (line) =>
            line.includes('compaction complete') &&
            line.includes('level=2') &&
            line.includes('txid.min=0000000000000001'),
        )
    ) {
      completed = true
      console.log('Initial full compactions complete')
      break
    }
    if (Date.now() - began > Number(values.timeout) * 1000)
      throw new Error('Startup deadline exceeded')
    await Bun.sleep(10_000)
  }
} finally {
  const settings = JSON.parse(readFileSync(join(out, 'settings.json'), 'utf8'))
  const samples = spawnSync(
    'curl',
    [
      '--fail',
      '--max-time',
      '20',
      '-s',
      `http://127.0.0.1:19100/_bench/samples?since=${settings.started}`,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  if (samples.status === 0) writeFileSync(join(out, 'samples.json'), samples.stdout)
  writeFileSync(
    join(out, 'result.json'),
    JSON.stringify({ completed, finished: Date.now() / 1000 }, null, 2),
  )
  try {
    docker(['stop', '--time', '10', container])
  } finally {
    release()
    process.removeListener('exit', release)
  }
}
