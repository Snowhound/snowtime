// A production build of the app, served on a free port with the benchmark database, and a
// signed-in browser context for it. The build is copied to perf/.cache/build, so a later
// `vite build` in .output can't swap the assets under a running server.

import { createClient } from '@libsql/client'
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { Browser, BrowserContext } from 'playwright-core'
import { shiftBrowserClock } from './clock'
import { CACHE, ROOT, SEED_NOW, USERS } from './database'

const BUILD = join(CACHE, 'build')
const LOCK = join(CACHE, 'build.lock')

// One build at a time: harnesses run in parallel share .output and .nitro.
async function withBuildLock<T>(run: () => T): Promise<T> {
  mkdirSync(CACHE, { recursive: true })
  for (let waited = 0; ; waited += 250) {
    try {
      mkdirSync(LOCK)
      break
    } catch {
      if (waited > 120_000) throw new Error(`[perf] ${LOCK} held for 2 minutes; remove it`)
      await Bun.sleep(250)
    }
  }
  try {
    return run()
  } finally {
    rmSync(LOCK, { recursive: true, force: true })
  }
}

// Builds the working tree as it is, about 10 seconds. Returns the build folder, laid out
// like .output (public/, server/).
export async function buildApp(): Promise<string> {
  return withBuildLock(() => {
    const started = performance.now()
    const result = spawnSync('bunx', ['--bun', 'vite', 'build'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production' },
    })
    if (result.status !== 0) {
      throw new Error(`[perf] vite build failed:\n${result.stdout}\n${result.stderr}`)
    }
    rmSync(BUILD, { recursive: true, force: true })
    cpSync(join(ROOT, '.output'), BUILD, { recursive: true })
    console.log(`[perf] Built in ${Math.round((performance.now() - started) / 1000)} s`)
    return BUILD
  })
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

export interface RunningApp {
  url: string
  pid: number
  stop: () => Promise<void>
}

// Serves a build on a free port, on a copy of the database so a run's writes (a started
// timer) don't reach the next run. With scene off, every user's background and weather are
// off, so page numbers are the app's own.
//
// NODE_ENV=development only turns on password sign-in (passwordEnabled); the code is the
// production build. The server runs from an empty folder so Bun loads none of the
// repository's .env files: OAuth keys there would change the sign-in page, and a database
// URL would win over the benchmark's.
//
// With executable, a compiled server (scripts/build-self-hosted.ts) runs instead of the build.
// It can't take clock.ts, so its clock is the real one.
export async function startApp({
  database,
  build = BUILD,
  scene = false,
  executable,
}: {
  database: string
  build?: string
  scene?: boolean
  executable?: string
}): Promise<RunningApp> {
  if (!executable && !existsSync(join(build, 'server/index.mjs'))) {
    throw new Error(`[perf] No build in ${build}`)
  }
  const port = await freePort()
  const copy = join(CACHE, `run-${port}.db`)
  cpSync(database, copy)
  const client = createClient({ url: `file:${copy}` })
  await client.execute(
    `update user_settings set scene_intro = 0${scene ? '' : ', scene_background = 0, scene_weather = 0'}`,
  )
  client.close()
  const url = `http://127.0.0.1:${port}`
  const cwd = join(CACHE, 'run')
  mkdirSync(cwd, { recursive: true })
  const log = join(CACHE, `server-${port}.log`)
  writeFileSync(log, '')
  const [command, ...args] = executable
    ? [executable]
    : ['bun', '--preload', join(ROOT, 'perf/lib/clock.ts'), join(build, 'server/index.mjs')]
  const server: ChildProcess = spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'development',
      PORT: String(port),
      HOST: '127.0.0.1',
      PERF_NOW: String(SEED_NOW.getTime()),
      TURSO_DATABASE_URL: `file:${copy}`,
      BETTER_AUTH_SECRET: 'perf-harness-secret-perf-harness-secret',
      BETTER_AUTH_URL: url,
    },
  })
  const output: string[] = []
  server.stdout?.on('data', (chunk) => output.push(String(chunk)))
  server.stderr?.on('data', (chunk) => output.push(String(chunk)))

  for (let waited = 0; ; waited += 100) {
    if (server.exitCode !== null) {
      throw new Error(`[perf] Server exited ${server.exitCode}:\n${output.join('')}`)
    }
    try {
      const response = await fetch(`${url}/sign-in`)
      if (response.ok) break
    } catch {}
    if (waited > 20_000) {
      server.kill()
      throw new Error(`[perf] Server didn't answer in 20 s:\n${output.join('')}`)
    }
    await Bun.sleep(100)
  }

  return {
    url,
    pid: server.pid!,
    stop: async () => {
      if (server.exitCode !== null) return
      const exited = new Promise((resolve) => server.once('exit', resolve))
      server.kill()
      await exited
      writeFileSync(log, output.join(''))
      rmSync(copy, { force: true })
    },
  }
}

// Session headers for a seeded user.
export async function signInHeaders(
  app: Pick<RunningApp, 'url'>,
  who: keyof typeof USERS = 'admin',
): Promise<Record<string, string>> {
  const response = await fetch(`${app.url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: app.url },
    body: JSON.stringify(USERS[who]),
  })
  if (!response.ok) throw new Error(`[perf] Sign-in as ${who}: ${response.status}`)
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0])
    .join('; ')
  return { cookie }
}

// A browser context signed in as one of the seeded users, with its clock at SEED_NOW, the
// intro and passkey prompt skipped. The session cookie
// is set without an expiry: the server's clock is shifted, so the expiry it sends may
// already be past for the browser's cookie store.
export async function signedInContext(
  browser: Browser,
  app: RunningApp,
  {
    who = 'admin',
    viewport = { width: 1440, height: 900 },
    deviceScaleFactor = 1.5,
  }: {
    who?: keyof typeof USERS
    viewport?: { width: number; height: number }
    deviceScaleFactor?: number
  } = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport, deviceScaleFactor })
  await shiftBrowserClock(context, SEED_NOW)
  await context.addInitScript(() => {
    localStorage.setItem('snowtime.introSeen', '1')
    localStorage.setItem('snowtime.introSeason', 'autumn')
    localStorage.setItem('snowtime.passkeyPromptDismissed', '1')
  })
  const { cookie } = await signInHeaders(app, who)
  const { hostname } = new URL(app.url)
  await context.addCookies(
    cookie.split('; ').map((pair) => {
      const [name, ...value] = pair.split('=')
      return { name, value: value.join('='), domain: hostname, path: '/' }
    }),
  )
  return context
}
