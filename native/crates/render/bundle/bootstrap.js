const core = Deno.core
/** @type {[string, string[]][]} */
const webApis = [
  ['01_dom_exception', ['DOMException']],
  ['02_event', ['Event', 'EventTarget']],
  ['03_abort_signal', ['AbortController', 'AbortSignal']],
  ['00_url', ['URL', 'URLSearchParams']],
  [
    '06_streams',
    [
      'ReadableStream',
      'WritableStream',
      'TransformStream',
      'ByteLengthQueuingStrategy',
      'CountQueuingStrategy',
    ],
  ],
  ['08_text_encoding', ['TextEncoder', 'TextDecoder', 'TextEncoderStream', 'TextDecoderStream']],
  ['09_file', ['Blob', 'File']],
  ['02_timers', ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']],
]
for (const [file, names] of webApis) {
  const exports = core.loadExtScript(`ext:deno_web/${file}.js`)
  for (const name of names) globalThis[name] = exports[name]
}
for (const [file, name] of [
  ['20_headers', 'Headers'],
  ['23_request', 'Request'],
  ['23_response', 'Response'],
]) {
  globalThis[name] = core.loadExtScript(`ext:deno_fetch/${file}.js`)[name]
}
globalThis.console = new (core.loadExtScript('ext:deno_web/01_console.js').Console)(
  (message, level) => core.print(message, level > 1),
)
globalThis.fetch = () => {
  throw new Error('Render code must use setSend, not fetch')
}
Deno.env = { toObject: () => ({ NODE_ENV: 'production' }) }
globalThis.structuredClone = core.loadExtScript('ext:deno_web/13_message_port.js').structuredClone
