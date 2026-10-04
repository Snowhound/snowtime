import { readFileSync, writeFileSync } from 'node:fs'
// Exercise host HTTP forwarding on native timer rules. Unported reads use captured answers.
import { resolve } from 'node:path'
import { signInHeaders } from '../../../../perf/lib/app'
import { seededDatabase } from '../../../../perf/lib/database'
import { startNative } from '../../../bench/native'

const root = resolve(import.meta.dir, '../../../..')
const results = resolve(import.meta.dir, '../results')
const answers = JSON.parse(readFileSync(resolve(results, 'answers.json'), 'utf8'))
const native = await startNative(
  resolve(root, 'native/target/release/snowtime-axum'),
  await seededDatabase(),
)
let nativeCalls = 0
let recordedCalls = 0
const proxy = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname + url.search
    const body = await request.text()
    if (
      url.pathname === '/api/v1/timer' ||
      /\/(entries|entries\/first-start|projects)$/.test(url.pathname)
    ) {
      nativeCalls++
      return fetch(`${native.url}${path}`, {
        method: request.method,
        headers: request.headers,
        body: body || undefined,
      })
    }
    recordedCalls++
    const answer = answers[`${request.method} ${path} ${body}`]
    if (!answer) return new Response('Unrecorded call', { status: 500 })
    return new Response(new Uint8Array(answer.body), {
      status: answer.status,
      headers: answer.headers,
    })
  },
})
try {
  const headers = await signInHeaders(native)
  for (const name of ['timer', 'week']) {
    const input = JSON.parse(readFileSync(resolve(results, `${name}.json`), 'utf8'))
    input.cookie = headers.cookie
    input.headers = Object.entries(headers)
    const page = resolve(results, `${name}-live.json`)
    writeFileSync(page, JSON.stringify(input))
    const child = Bun.spawn(
      [
        resolve(root, 'native/target/release/render-bench'),
        'thread',
        page,
        `http://127.0.0.1:${proxy.port}`,
        '1',
        resolve(results, `${name}-live.html`),
      ],
      { stdout: 'inherit', stderr: 'inherit' },
    )
    if ((await child.exited) !== 0) throw new Error(`${name} failed`)
  }
  console.log(JSON.stringify({ nativeCalls, recordedCalls }))
} finally {
  await proxy.stop(true)
  await native.stop()
}
