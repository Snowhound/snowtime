// bun-bench.ts for the jsc shell. Run it through run-jsc.mjs, which reads the process's
// CPU and peak RSS from /proc while this script waits on readline() at each @@MARK.
//
// jsc [options] jsc-bench.js -- <polyfills.js> <bundle.js> <manifest.json> <page.json>
//     <answers.json> [count] [output.html]
const [polyfillsPath, bundlePath, manifestPath, pagePath, answersPath, countArg, outputPath] =
  arguments
load(polyfillsPath)
const count = Number(countArg ?? 500)
if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer')

function mark(name) {
  print('@@MARK ' + name)
  readline()
}

const page = JSON.parse(readFile(pagePath))
const answers = JSON.parse(readFile(answersPath))
for (const answer of Object.values(answers)) answer.body = new Uint8Array(answer.body)
let status = 0
let chunks = []
const decoder = new TextDecoder()
// The environment the render crate's bootstrap.js gives the bundle
const env = { NODE_ENV: 'production' }
globalThis.Deno = {
  env: { toObject: () => ({ ...env }), get: (key) => env[key] },
  core: {
    ops: {
      async op_send(input) {
        const key =
          input.method + ' ' + input.path + ' ' + decoder.decode(new Uint8Array(input.body))
        const answer = answers[key]
        if (!answer) throw new Error('Unrecorded API request: ' + key)
        return { ...answer, body: new Uint8Array(answer.body) }
      },
      op_head(value) {
        status = value
      },
      op_chunk(chunk) {
        chunks.push(chunk)
      },
    },
  },
}
globalThis.renderManifest = JSON.parse(readFile(manifestPath))

function concat(parts) {
  let length = 0
  for (const p of parts) length += p.byteLength
  const out = new Uint8Array(length)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.byteLength
  }
  return out
}

async function render() {
  status = 0
  chunks = []
  await globalThis.renderPage(page)
  if (status !== 200) throw new Error('Rendered status ' + status)
  return concat(chunks)
}

async function main() {
  const started = performance.now()
  load(bundlePath)
  const first = await render()
  const text = decoder.decode(first)
  if (!text.includes('data-hk=') || text.includes("This page didn't load"))
    throw new Error('Rendered an error page')
  if (outputPath) writeFile(outputPath, first)
  const startup = performance.now() - started
  for (let i = 0; i < 50; i++) await render()
  // The wrapper waits 1.5 s here, as bun-bench's Bun.sleep(1500), then samples CPU.
  mark('start')
  const times = []
  const measured = performance.now()
  for (let i = 0; i < count; i++) {
    const begin = performance.now()
    await render()
    times.push(performance.now() - begin)
  }
  const elapsed = performance.now() - measured
  mark('end')
  times.sort((a, b) => a - b)
  print(
    '@@RESULT ' +
      JSON.stringify({
        engine: 'jsc-shell',
        page: pagePath,
        count,
        bytes: first.byteLength,
        startup_ms: startup,
        pages_per_s: (count * 1000) / elapsed,
        p50_ms: times[Math.floor(count / 2)],
        p95_ms: times[Math.floor((count * 95) / 100)],
      }),
  )
}

main().catch((error) => {
  printErr('jsc-bench failed: ' + error + '\n' + error.stack)
  print('@@FAILED')
})
