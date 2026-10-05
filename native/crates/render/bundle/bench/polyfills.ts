import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TextDecoder, TextEncoder } from 'text-encoding'
import {
  ReadableStream,
  WritableStream,
  TransformStream,
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
} from 'web-streams-polyfill'

for (const name of [
  'URL',
  'URLSearchParams',
  'TextEncoder',
  'TextDecoder',
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'Headers',
  'Request',
  'Response',
  'Blob',
  'File',
]) {
  Reflect.deleteProperty(globalThis, name)
}
await import('core-js/actual/url/index.js')
await import('core-js/actual/url-search-params/index.js')
Object.assign(globalThis, {
  TextEncoder,
  TextDecoder,
  ReadableStream,
  WritableStream,
  TransformStream,
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
})
TextEncoder.prototype.encodeInto = function (text: string, target: Uint8Array) {
  let read = 0
  let written = 0
  for (const character of text) {
    const bytes = this.encode(character)
    if (written + bytes.length > target.length) break
    target.set(bytes, written)
    written += bytes.length
    read += character.length
  }
  return { read, written }
}
// The fetch polyfill imports node:util encoding; route it to the JS fallback too.
Bun.plugin({
  name: 'polyfill-fetch-encoding',
  setup(build) {
    build.onLoad({ filter: /web-fetch\/src\/utils\/utf8\.js$/ }, ({ path }) => ({
      contents: readFileSync(path, 'utf8').replace(
        "from 'util'",
        'from ' + JSON.stringify(resolve(import.meta.dir, 'node_modules/text-encoding/index.js')),
      ),
      loader: 'js',
    }))
  },
})
const fetch = await import('@remix-run/web-fetch')
Object.assign(globalThis, {
  Headers: fetch.Headers,
  Request: fetch.Request,
  Response: fetch.Response,
  Blob: fetch.Blob,
  File: fetch.File,
})
