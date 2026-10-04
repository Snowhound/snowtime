import { readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { signInHeaders, startApp } from '../../../../perf/lib/app'
import { seededDatabase, SEED_NOW } from '../../../../perf/lib/database'
import { installClock } from './clock'
// Capture the current build's API answers and manifest, without query-cache seeding.
import type { ApiAnswer, Head, PageInput } from './contract'

const root = resolve(import.meta.dir, '../../../..')
const out = resolve(import.meta.dir, '../results')
mkdirSync(out, { recursive: true })
const app = await startApp({ database: await seededDatabase(), build: resolve(root, '.output') })
try {
  const headers = await signInHeaders(app)
  const file = readdirSync(resolve(root, '.output/server')).find((name) =>
    name.startsWith('_tanstack-start-manifest_'),
  )!
  const { tsrStartManifest } = await import(resolve(root, '.output/server', file))
  const manifest = tsrStartManifest()
  const answers: Record<string, ApiAnswer> = {}
  let head: Head | undefined
  let chunks: Uint8Array[] = []
  globalThis.Deno = {
    core: {
      ops: {
        async op_send(input) {
          const response = await fetch(`${app.url}${input.path}`, {
            method: input.method,
            headers: input.headers,
            body: input.body.length ? new Uint8Array(input.body) : undefined,
          })
          const answer = {
            status: response.status,
            headers: [...response.headers],
            body: Array.from(new Uint8Array(await response.arrayBuffer())),
          }
          answers[
            `${input.method} ${input.path} ${new TextDecoder().decode(new Uint8Array(input.body))}`
          ] = answer
          if (!response.ok) throw new Error(`${input.path}: ${response.status}`)
          return answer
        },
        op_head(input) {
          head = input
        },
        async op_chunk(input) {
          chunks.push(input)
        },
      },
    },
  }
  installClock(SEED_NOW.getTime())
  await import(resolve(import.meta.dir, 'dist/render.js'))
  for (const [name, path] of [
    ['timer', '/lumen/timer'],
    ['week', '/lumen/reports?range=this-week'],
  ]) {
    chunks = []
    const input: PageInput = {
      url: `${app.url}${path}`,
      method: 'GET',
      headers: Object.entries(headers),
      cookie: headers.cookie,
      nonce: 'render-harness-nonce',
      locale: 'en',
      manifest,
    }
    await globalThis.renderPage(input)
    const html = Buffer.concat(chunks).toString()
    if (
      head?.status !== 200 ||
      !html.includes('data-hk=') ||
      html.includes("This page didn't load")
    )
      throw new Error(`${name} failed`)
    writeFileSync(
      resolve(out, `${name}.json`),
      JSON.stringify({ ...input, now: SEED_NOW.getTime() }),
    )
    writeFileSync(resolve(out, `${name}-bun.html`), html)
    writeFileSync(
      resolve(out, `${name}-start.html`),
      await (await fetch(`${app.url}${path}`, { headers })).text(),
    )
    console.log(
      `${name}: ${head?.status}, ${Buffer.byteLength(html)} bytes, ${chunks.length} chunks`,
    )
  }
  writeFileSync(resolve(out, 'answers.json'), JSON.stringify(answers))
  writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest))
  console.log(`Captured ${Object.keys(answers).length} API requests`)
} finally {
  await app.stop()
}
