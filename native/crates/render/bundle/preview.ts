// Serve the measured documents and the matching production assets for manual review.
import { resolve } from 'node:path'
const root = resolve(import.meta.dir, '../../../..')
const results = resolve(import.meta.dir, '../results')
const answers = await Bun.file(resolve(results, 'answers.json')).json()
const server = Bun.serve({
  port: 34981,
  hostname: '127.0.0.1',
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      const answer =
        answers[`${request.method} ${url.pathname}${url.search} ${await request.text()}`]
      return answer
        ? new Response(new Uint8Array(answer.body), {
            status: answer.status,
            headers: answer.headers,
          })
        : new Response('Unrecorded request', { status: 500 })
    }
    if (url.pathname === '/lumen/timer' || url.pathname === '/lumen/reports') {
      const name = url.pathname.endsWith('timer') ? 'timer' : 'week'
      return new Response(Bun.file(resolve(results, `${name}-v8.html`)), {
        headers: { 'content-type': 'text/html' },
      })
    }
    const file = resolve(root, '.output/public', `.${url.pathname}`)
    if (!file.startsWith(resolve(root, '.output/public') + '/'))
      return new Response(null, { status: 404 })
    return new Response(Bun.file(file))
  },
})
console.log(`Renderer preview: http://127.0.0.1:${server.port}/lumen/reports?range=this-week`)
