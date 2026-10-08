// A native server on a copy of the benchmark database, with its clock at SEED_NOW and
// password sign-in on, as conformance/server.ts expects a server under test to run. As
// perf/lib/app.ts's startApp does, it turns every user's scene off.
import { createClient } from '@libsql/client'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { freePort } from '../../perf/lib/app'
import { CACHE, SEED_NOW } from '../../perf/lib/database'

export async function startNative(
  binary: string,
  database: string,
  env: Record<string, string> = {},
) {
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const copy = join(CACHE, `native-${port}.db`)
  cpSync(database, copy)
  const client = createClient({ url: `file:${copy}` })
  await client.execute(
    'update user_settings set scene_intro = 0, scene_background = 0, scene_weather = 0',
  )
  client.close()
  const server = spawn(binary, [], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(port),
      PERF_NOW: String(SEED_NOW.getTime()),
      TURSO_DATABASE_URL: `file:${copy}`,
      BETTER_AUTH_SECRET: 'perf-harness-secret-perf-harness-secret',
      BETTER_AUTH_URL: url,
      ...(process.env.DB_READ_CONNECTIONS && {
        DB_READ_CONNECTIONS: process.env.DB_READ_CONNECTIONS,
      }),
      EDGE_ACCESS_LOG: 'off',
      RATE_LIMIT: 'off',
      ...env,
    },
  })
  for (let waited = 0; ; waited += 100) {
    if (server.exitCode !== null) throw new Error(`[native] ${binary} exited ${server.exitCode}`)
    if (
      await fetch(`${url}/api/v1/availability`).then(
        (r) => r.ok,
        () => false,
      )
    )
      break
    if (waited > 10_000) throw new Error(`[native] ${binary} didn't answer in 10 s`)
    await Bun.sleep(100)
  }
  return {
    url,
    pid: server.pid!,
    stop: async () => {
      server.kill()
      if (server.exitCode === null) await new Promise((resolve) => server.once('exit', resolve))
      rmSync(copy, { force: true })
      rmSync(`${copy}-journal`, { force: true })
      rmSync(`${copy}-wal`, { force: true })
      rmSync(`${copy}-shm`, { force: true })
    },
  }
}

let ticksPerSecond: number | undefined
export function processUsage(pid: number) {
  ticksPerSecond ??= Number(spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).stdout.trim())
  if (!ticksPerSecond) throw new Error('Cannot read CLK_TCK')
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(')').at(-1)!.trim().split(/\s+/)
  const status = readFileSync(`/proc/${pid}/status`, 'utf8')
  function kib(name: string) {
    const value = status.match(new RegExp(`^${name}:\\s+(\\d+) kB`, 'm'))
    if (!value) throw new Error(`Missing ${name} for pid ${pid}`)
    return Number(value[1])
  }
  return {
    cpuMs: ((Number(stat[11]) + Number(stat[12])) * 1000) / ticksPerSecond,
    peakMiB: kib('VmHWM') / 1024,
    rssMiB: kib('VmRSS') / 1024,
    swapKiB: kib('VmSwap'),
  }
}
