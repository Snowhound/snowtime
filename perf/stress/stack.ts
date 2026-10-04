// The local bench stack: the release images built from the checkout for this machine, and
// deploy/compose's files with compose.bench.yml and compose.bench.local.yml on top
// (perf/README.md, "Load benchmark").

import { spawnSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { ROOT } from '../lib/database'

export const LOCAL_HOST = 'snowtime-bench.test'
export const LOCAL_PORT = 8443
// Only the local stack uses these. On a server, .env holds its own.
export const LOCAL_SECRET = 'bench-secret-bench-secret-bench-secret'
export const LOCAL_SAMPLER_PASSWORD = 'bench'
// `caddy hash-password --plaintext bench`
const LOCAL_SAMPLER_HASH = '$2a$14$TJKqnpDNtE7n3hk6G1xmye0OG1SCOtY9MiW7enQBfNbAgQMvygAlC'
export const K6_IMAGE = 'grafana/k6:2.3.0'
export const NETWORK = 'snowtime-bench_default'
const VOLUME = 'snowtime_bench_data'
const COMPOSE = join(ROOT, 'deploy/compose')

function run(command: string, args: string[], options: { env?: Record<string, string> } = {}) {
  const result = spawnSync(command, args, {
    cwd: COMPOSE,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
  })
  if (result.status !== 0) throw new Error(`[stress] ${command} ${args.join(' ')} failed`)
}

// Which backend runs as the app: the TypeScript release image, or the native backend of task
// 081 (native/Dockerfile), which compose.bench.native.yml puts in its place.
export type App = 'ts' | 'native'
let app: App = 'ts'

export function useApp(next: App) {
  app = next
}

export function compose(args: string[], env: Record<string, string> = {}) {
  run(
    'docker',
    [
      'compose',
      '-f',
      'compose.yml',
      '-f',
      'compose.bench.yml',
      '-f',
      'compose.bench.local.yml',
      ...(app === 'native' ? ['-f', 'compose.bench.native.yml'] : []),
      ...(env.BENCH_CADDY_CONFIG ? ['-f', 'compose.bench.edge.yml'] : []),
      ...args,
    ],
    {
      env: {
        RELEASE: 'bench',
        APP_HOST: LOCAL_HOST,
        BENCH_PORT: String(LOCAL_PORT),
        BENCH_GENERATOR_IP: 'private_ranges',
        BENCH_AUTH_SECRET: LOCAL_SECRET,
        BENCH_SAMPLER_HASH: LOCAL_SAMPLER_HASH,
        ...env,
      },
    },
  )
}

// Builds the three images natively; Docker's cache makes a rebuild of unchanged code quick.
// NATIVE_BIN picks the host binary (snowtime-axum by default).
export function buildImages() {
  for (const target of app === 'native' ? ['caddy', 'sampler'] : ['app', 'caddy', 'sampler']) {
    run('docker', ['build', '--target', target, '-t', `snowtime-${target}:bench`, ROOT])
  }
  if (app === 'native') {
    const bin = process.env.NATIVE_BIN ?? 'snowtime-axum'
    const native = join(ROOT, 'native')
    run('docker', [
      'build',
      '-f',
      join(native, 'Dockerfile'),
      '--build-arg',
      `BIN=${bin}`,
      '-t',
      'snowtime-native:bench',
      native,
    ])
  }
}

// Replaces the bench volume's database with the dataset, while the app is stopped, and drops
// the page cache, so the run starts as a server would after a restart: from the disk.
export function loadDataset(database: string) {
  compose(['stop', 'app'])
  run('docker', [
    'run',
    '--rm',
    '-v',
    `${VOLUME}:/data`,
    '-v',
    `${dirname(database)}:/source:ro`,
    'alpine',
    'sh',
    '-c',
    `rm -f /data/snowtime.db /data/snowtime.db-* && cp /source/${basename(database)} /data/snowtime.db && chown -R 10001:10001 /data`,
  ])
  dropCaches()
}

function dropCaches() {
  run('docker', [
    'run',
    '--rm',
    '--privileged',
    'alpine',
    'sh',
    '-c',
    'sync && echo 3 > /proc/sys/vm/drop_caches',
  ])
}

// Starts the stack, or recreates its containers with changed settings, such as a memory
// limit, and waits until the app is healthy.
export function startStack(env: Record<string, string> = {}) {
  compose(['up', '-d', '--wait', '--force-recreate'], env)
}
